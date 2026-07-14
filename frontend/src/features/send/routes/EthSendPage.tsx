"use client";

// Send ETH (Sepolia) - purpose-built sibling of /send.
//
// The Solana send path is the original /send/page.tsx, untouched.
// This page exists for cross-chain. The flow:
//
//   1. Read the wallet's EVM binding (Ika dWallet → Sepolia address).
//      No binding => bounce to /chains/add.
//   2. Read the wallet's EVM intent (intent_index for the
//      EvmTransfer template). No intent => bounce to /setup/eth.
//   3. User enters recipient (0x...) + amount in ETH + optional note.
//   4. Frontend fetches the wallet's current EVM nonce from the
//      destination RPC.
//   5. prepare.createProposal with intent_index + EVM params.
//   6. signMessage on Solana (the multisig is on Solana - your
//      signature gates the EVM-side action).
//   7. submit.createProposal lands the proposal Approved on chain
//      (program auto-approves proposer-in-approvers, mirrors the
//      SolTransfer setup ceremony).
//   8. executeProposal with broadcast=true and Ika dWallet params
//      so the dWallet network signs + broadcasts the actual ETH tx
//      to Sepolia.
//
// SignPayloadPreview shows the user the EVM-side facts BEFORE the
// signing request fires: chain, recipient, amount-in-ETH, and the budget
// impact under the policy.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  List as ListIcon,
  Loader2,
  Send,
  ShieldAlert,
} from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import {
  broadcastExplorerUrl,
  explorerLabelForChainKind,
  type BroadcastResultLike,
} from "@/lib/explorer";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { recordAttempt } from "@/lib/retail/txLog";
import { IntentType, toHex } from "@/lib/msig";
import { encodeParams } from "@/lib/msig/encode";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import {
  prepareClearSignAction,
  randomActionLabel,
  textCommitmentHex,
  type ClearSignEnvelope,
  type SendPayload,
} from "@/lib/clearsign-v2";
import {
  ethToWei,
  fetchEvmBalance,
  fetchEvmGasPrice,
  fetchEvmNonce,
  isValidEvmAddress,
  shortEvmAddress,
  weiToEth,
} from "@/lib/chain/eth";
import { looksLikeEnsName, resolveEnsName } from "@/lib/chain/ens";
import { QrScanButton } from "@/components/retail/QrScanButton";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import {
  assertPolicyNotDenied,
  resolvePolicyEnforcement,
} from "@/lib/policies/enforce";
import {
  policyCommitmentHexForParts,
} from "@/lib/policies/onchain";
import { resolvePersistentSendPolicy } from "@/lib/policies/persistentWalletPolicy";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { SendProgressStage } from "@/features/send/ui/SendProgressStage";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { FormField, TextInput } from "@/components/retail/FormField";
import {
  SendReceipt,
  type ReceiptDetail,
} from "@/components/retail/SendReceipt";
import { UsdHint } from "@/components/retail/UsdHint";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import { chainByKind } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { appConfig } from "@/lib/config";
import {
  SEND_NOTE_LABEL,
  SEND_NOTE_MAX_LENGTH,
  SEND_NOTE_PLACEHOLDER,
} from "@/lib/sendFields";
import { liveUsdEstimate } from "@/lib/clearsign-v2/fiatEstimate";
import { ComposeStage } from "@/features/send/ui/evm/EvmNativeSendStages";
import { PreFlightCard, SentStage } from "@/features/send/ui/evm/EvmNativeSendResults";

type Stage = "compose" | "sending" | "sent";


export default function SendEthPageWrapper() {
  return (
    <Suspense
      fallback={<div className="min-h-screen" aria-hidden="true" />}
    >
      <SendEthPage />
    </Suspense>
  );
}

function SendEthPage() {
  const params = useSearchParams();
  const route = useParams<{ name: string }>();
  const isHyperliquid = params?.get("network") === "hyperliquid";
  const EVM_CHAIN_KIND = isHyperliquid ? 5 : 1;
  const EVM_LABEL = isHyperliquid ? "Hyperliquid" : "Ethereum";
  const EVM_TICKER = isHyperliquid ? "HYPE" : "ETH";
  const EVM_RPC_URL = isHyperliquid
    ? appConfig.preAlpha.hyperliquidRpcUrl
    : appConfig.preAlpha.destinationRpcUrl;
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signTypedDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  const walletName = useMemo(() => {
    const raw = route?.name ?? "";
    try {
      return decodeURIComponent(raw).trim();
    } catch {
      return raw.trim();
    }
  }, [route?.name]);
  const walletDisplay = toDisplayName(walletName);

  const walletQuery = useQuery({
    queryKey: ["wallet", walletName],
    queryFn: () => fetchWalletByName(connection, walletName),
    enabled: walletName.length > 0,
    staleTime: 30_000,
  });
  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      return listIntents(
        connection,
        walletQuery.data.pda,
        walletQuery.data.account.intentIndex,
      );
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
    // Force a fresh fetch every time we land on this page, even if
    // the cache is technically still fresh. Without this, a user who
    // just completed /setup/eth navigates here with the old
    // (pre-setup) intents list in cache. StaleTime hasn't elapsed ,
    // and the page renders "Turn on Ethereum sending" again because
    // it doesn't see the just-created EvmTransfer intent. The Solana
    // RPC propagation race makes the background refetch a moment
    // later, but the user has already re-clicked Enable by then.
    refetchOnMount: "always",
  });
  const chainsQuery = useWalletChains(walletName);

  // Match the wallet's EvmTransfer intent and the corresponding
  // binding. Both must be present to send.
  const ethIntent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === EVM_CHAIN_KIND,
      ) ?? null
    );
  }, [intentsQuery.data, EVM_CHAIN_KIND]);
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === EVM_CHAIN_KIND,
    );
  }, [chainsQuery.data, EVM_CHAIN_KIND]);
  const walletEthAddress = ethBinding ? chainAddress(ethBinding) : null;

  // Both isLoading (first fetch) AND isFetching (background refetch
  // after invalidation / refetchOnMount) gate the "needs setup" UI.
  // Otherwise a user landing here straight from /setup/eth sees the
  // pre-setup cache for ~200ms and gets routed back into "Enable"
  // before the background refetch returns the just-created intent.
  const allSettled =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading &&
    !intentsQuery.isFetching &&
    !chainsQuery.isFetching;
  const needsBinding = allSettled && !ethBinding;
  const needsIntent = allSettled && !!ethBinding && !ethIntent;
  // Keep `allLoaded` as a backwards-compat alias so existing render
  // logic that uses it for skeleton gating keeps working.
  const allLoaded = allSettled;

  const [stage, setStage] = useState<Stage>("compose");
  // Initial values from URL params so /app/wallet/[name]'s
  // QuickAction input can route here with the form pre-filled.
  const [amount, setAmount] = useState(() => params?.get("amount")?.trim() ?? "");
  const [recipient, setRecipient] = useState(() => params?.get("recipient")?.trim() ?? "");
  const [note, setNote] = useState(() => params?.get("note")?.trim() ?? "");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    to: string;
    explorerUrl: string | null;
    explorerLabel: string;
    pending: boolean;
    proposal: string | null;
  } | null>(null);

  const trimmedRecipient = recipient.trim();
  const directlyValid = isValidEvmAddress(trimmedRecipient);

  // ENS resolution - fired when the typed text doesn't already
  // look like a 0x address but does look like an ENS name. The
  // resolved 0x address is what we sign / broadcast against; the
  // user-typed name is preserved for display only.
  const shouldTryEns =
    !directlyValid && looksLikeEnsName(trimmedRecipient);
  const ensQuery = useQuery({
    queryKey: ["ens-resolve", trimmedRecipient.toLowerCase()],
    queryFn: () => resolveEnsName(trimmedRecipient),
    enabled: shouldTryEns,
    staleTime: 5 * 60 * 1000,
    retry: 0,
  });
  const ensAddress =
    shouldTryEns && ensQuery.data ? ensQuery.data : null;
  const ensResolving =
    shouldTryEns && (ensQuery.isLoading || ensQuery.isFetching);
  const ensFailed =
    shouldTryEns &&
    !ensResolving &&
    ensQuery.isFetched &&
    !ensQuery.data;

  // The address we'll actually sign + broadcast to. Either the
  // pasted 0x address or the ENS-resolved address.
  const effectiveRecipient = directlyValid
    ? trimmedRecipient
    : ensAddress;
  const recipientValid = !!effectiveRecipient;
  let amountValid = false;
  let amountWei = 0n;
  try {
    if (amount.trim()) {
      amountWei = ethToWei(amount);
      amountValid = amountWei > 0n;
    }
  } catch {
    amountValid = false;
  }

  // Live wallet EVM balance for the dWallet address on the selected network. Fetched
  // every 15s; refreshed after a successful send so the post-send
  // balance is fresh. Drives the "Wallet has X.XXXX ETH/HYPE" display + the
  // pre-flight insufficient-balance check below.
  const ethBalanceQuery = useQuery({
    queryKey: [
      "wallet-evm-native-balance",
      EVM_CHAIN_KIND,
      EVM_RPC_URL,
      walletEthAddress ?? "",
    ],
    queryFn: () => fetchEvmBalance(walletEthAddress!, EVM_RPC_URL),
    enabled: !!walletEthAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Live gas price from the destination RPC. Refetched every 30s so
  // a Sepolia base-fee spike doesn't leave the user stuck with an
  // off-by-2x reserve. Falls back to a 50-gwei default below if the
  // query is still loading or errored - over-reserving is the safe
  // direction (lets a real send through later; doesn't push a
  // doomed one through now).
  const gasPriceQuery = useQuery({
    queryKey: ["evm-gas-price", EVM_RPC_URL],
    queryFn: () => fetchEvmGasPrice(EVM_RPC_URL),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });

  // 21000 gas for a value transfer (no calldata). Solidity calls
  // would need more, but the EVM intent template only does ETH
  // transfers; if that changes, read gas_limit from the intent's
  // tx_template (8 bytes at offset 8) instead.
  const VALUE_TRANSFER_GAS = 21_000n;
  // Headroom multiplier - 50% over the live estimate so a spike
  // mid-broadcast doesn't trip the wallet's effective balance.
  const GAS_RESERVE_HEADROOM_NUMER = 3n;
  const GAS_RESERVE_HEADROOM_DENOM = 2n;
  // Floor: 50 gwei × 21000 = 0.00105 ETH. Used when the live price
  // hasn't loaded yet so the Max button + insufficient-balance
  // check stay populated and the UX doesn't flicker.
  const FALLBACK_GAS_PRICE_WEI = 50_000_000_000n; // 50 gwei

  const liveGasPriceWei = gasPriceQuery.data ?? FALLBACK_GAS_PRICE_WEI;
  const ETH_GAS_RESERVE_WEI =
    (liveGasPriceWei * VALUE_TRANSFER_GAS * GAS_RESERVE_HEADROOM_NUMER) /
    GAS_RESERVE_HEADROOM_DENOM;

  const balance = ethBalanceQuery.data ?? null;
  const balanceLoaded = ethBalanceQuery.isFetched && balance !== null;
  const requiredWei = amountValid ? amountWei + ETH_GAS_RESERVE_WEI : 0n;
  // Block submit when we know the balance is too low. While the
  // balance is still loading, don't block - the propose step is
  // safe; the broadcast itself will short-circuit if the balance
  // really is empty.
  const insufficientBalance =
    balanceLoaded && amountValid && balance! < requiredWei;

  // Policy-rule pre-flight tripwire (Tier-5 #33). Same shape as the
  // SOL send: deny rules block submit, require-* surface friction
  // banners. ENS-resolved address is already in effectiveRecipient.
  const policyEvaluation = usePolicyEvaluation({
    walletName,
    chainKind: EVM_CHAIN_KIND,
    recipient: effectiveRecipient ?? "",
    ticker: EVM_TICKER,
    amountDisplay: amount,
    enabled: amountValid && !!effectiveRecipient,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";

  const canSubmit =
    amountValid &&
    recipientValid &&
    !!ethIntent &&
    !!walletEthAddress &&
    !!wallet.publicKey &&
    !insufficientBalance &&
    !policyDenied;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!ethIntent || !ethIntent.account)
        throw new Error(`${EVM_LABEL} sending isn't set up for this wallet`);
      if (!walletEthAddress)
        throw new Error(`Wallet's ${EVM_LABEL} address isn't ready yet`);
      if (!recipientValid || !effectiveRecipient)
        throw new Error("Recipient must be a valid 0x address or .eth name");

      const proposerPk = wallet.pickSigner(ethIntent.account.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }
      const submitPolicyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: EVM_CHAIN_KIND,
        recipient: effectiveRecipient,
        ticker: EVM_TICKER,
        amountDisplay: amount,
      });
      assertPolicyNotDenied(submitPolicyPlan);
      const walletPda = walletQuery.data?.pda;
      if (!walletPda) throw new Error("Wallet is still loading. Try again.");
      const onchainPolicy = await resolvePersistentSendPolicy(
        connection,
        walletPda,
        walletName,
        EVM_CHAIN_KIND,
      );

      // 1. Pull the live nonce. Without this the EVM tx the dWallet
      //    signs gets rejected as a duplicate.
      const { nonce } = await fetchEvmNonce(walletEthAddress, EVM_RPC_URL);

      const recipientForClearSign = effectiveRecipient.toLowerCase();
      const paramsDataHex = toHex(
        encodeParams(ethIntent.account, {
          nonce: String(nonce),
          to: recipientForClearSign,
          value_wei: amountWei.toString(),
          data: "",
        }),
      );

      // 2. Prepare a typed ClearSign proposal. The readable text and
      //    commitment cover the recipient, amount, asset, policy, nonce,
      //    and expiry. The raw EVM params bytes are passed later into the
      //    typed Ika signer, where the program verifies they match this
      //    signed ClearSign action before asking Ika to sign.
      const actionId = randomActionLabel(
        isHyperliquid ? "hype-send" : "eth-send",
      );
      const actionNonce = randomActionLabel("nonce");
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const policyCommitment =
        onchainPolicy?.commitmentHex ??
        policyCommitmentHexForParts([
          `wallet:${walletQuery.data?.pda.toBase58() ?? walletName}`,
          `intent:${ethIntent.account.intentIndex}`,
          `chain:${EVM_CHAIN_KIND}`,
          `threshold:${ethIntent.account.approvalThreshold ?? ""}`,
          `proposers:${ethIntent.account.proposers.join(",")}`,
          `approvers:${ethIntent.account.approvers.join(",")}`,
        ]);
      const envelope: ClearSignEnvelope<SendPayload> = {
        version: 2,
        kind: "send",
        walletName,
        walletId: walletQuery.data?.pda.toBase58(),
        actionId,
        nonce: actionNonce,
        expiresAt,
        policyCommitment,
        payload: {
          recipient: recipientForClearSign,
          recipientEncoding: "sha256_text",
          amount: amount.trim(),
          asset: EVM_TICKER,
          assetEncoding: "sha256_text",
          note: note.trim() || undefined,
          estimatedUsd: liveUsdEstimate(amount, EVM_TICKER),
        },
      };
      const summary = await prepareClearSignAction(envelope, {
        fallback: false,
      });
      const dry = await backendApi.prepare.createTypedProposal(walletName, {
        intent_index: ethIntent.account.intentIndex,
        action_kind: summary.actionKindCode,
        policy_commitment: envelope.policyCommitment,
        payload_hash: summary.payloadHash,
        envelope_hash: summary.envelopeHash,
        action_id: envelope.actionId,
        nonce: envelope.nonce,
        policyBytesHex: onchainPolicy?.hex,
        signable_text: summary.signableText,
        expiry: formatUnixSigningExpiry(envelope.expiresAt),
        actor_pubkey: proposerPk.toBase58(),
      });

      // 3. Sign on Solana. Proves to the program that this user is
      //    a proposer + counts as their approval.
      const signed = await signTypedDescriptor(dry, {
        preferSigner: proposerPk,
        expectedTyped: {
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          signableText: summary.signableText,
        },
      });

      // 4. Submit. Lands the proposal Approved on chain (program's
      //    auto-approve when proposer-in-approvers).
      const submitted = await backendApi.submit.createTypedProposal(walletName, {
        ...signed,
        expiry: dry.expiry,
        intent_index: dry.intent_index,
        action_kind: dry.action_kind,
        policy_commitment: dry.policy_commitment_hex,
        payload_hash: dry.payload_hash_hex,
        envelope_hash: dry.envelope_hash_hex,
        action_id: dry.action_id,
        nonce: dry.nonce,
        policyBytesHex: onchainPolicy?.hex,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from submit");
      }
      const intent = ethIntent.account;
      const approverPk = wallet.pickSigner(intent.approvers);

      // Old-program fallback: re-sign approve if the propose did not
      // auto-approve. With the upgrade this branch never fires.
      const decision = await approveIfNeeded(connection, proposal, {
        approvers: intent.approvers,
        approverPubkey: approverPk?.toBase58() ?? null,
      });
      if (decision.needsApproveSignature) {
        if (!approverPk) {
          throw new Error(
            "The proposal landed, but none of your connected wallets can approve it.",
          );
        }
        const approveDry = await backendApi.prepare.approveTypedProposal(
          walletName,
          proposal,
          { actor_pubkey: approverPk.toBase58() },
        );
        const approveSigned = await signTypedDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveTypedProposal(walletName, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }

      const policyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: EVM_CHAIN_KIND,
        recipient: effectiveRecipient ?? "",
        ticker: EVM_TICKER,
        amountDisplay: amount,
      });
      assertPolicyNotDenied(policyPlan);
      if (policyPlan.evaluation?.matched) {
        if (policyPlan.rule?.action === "require-extra-approvers") {
          const seen = new Set<string>([
            proposerPk.toBase58(),
            ...(approverPk ? [approverPk.toBase58()] : []),
          ]);
          const extraApprovers = policyPlan.extraApprovers.filter((addr) => {
            const normalized = addr.trim();
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          });
          if (extraApprovers.length === 0) {
            throw new Error(
              `Policy "${policyPlan.rule.name}" requires extra approvers, but none were configured.`,
            );
          }
          for (const extraApprover of extraApprovers) {
            if (!intent.approvers.includes(extraApprover)) {
              throw new Error(
                `Policy "${policyPlan.rule.name}" requires ${extraApprover} to approve this send, but that signer is not in the wallet's approver list.`,
              );
            }
            const extraSigner = wallet.pickSigner([extraApprover]);
            if (!extraSigner) {
              throw new Error(
                `Policy "${policyPlan.rule.name}" requires ${extraApprover} to approve this send, but none of your connected wallets can sign as that approver.`,
              );
            }
            const extraDry = await backendApi.prepare.approveTypedProposal(
              walletName,
              proposal,
              { actor_pubkey: extraSigner.toBase58() },
            );
            const extraSigned = await signTypedDescriptor(extraDry, {
              preferSigner: extraSigner,
            });
            await backendApi.submit.approveTypedProposal(walletName, proposal, {
              ...extraSigned,
              expiry: extraDry.expiry,
            });
          }
        } else if (
          policyPlan.rule?.action === "require-cooldown" &&
          policyPlan.extraCooldownSeconds > 0
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, policyPlan.extraCooldownSeconds * 1000),
          );
        }
      }

      const readyToExecute = await waitForProposalApproval(connection, proposal);
      if (!readyToExecute) {
        return { proposal, broadcast: null, awaitingApprovers: true };
      }

      // 5. Execute with typed ClearSign verification + Ika broadcast.
      const executed = await backendApi.executeTypedChainSend(walletName, proposal, {
        chainKind: EVM_CHAIN_KIND,
        amountRaw: amountWei.toString(),
        recipientHash: textCommitmentHex(recipientForClearSign),
        assetIdHash: textCommitmentHex(EVM_TICKER),
        paramsDataHex,
        broadcast: true,
        dwalletProgram: appConfig.preAlpha.dwalletProgramId,
        grpcUrl: appConfig.preAlpha.grpcUrl,
        rpcUrl: EVM_RPC_URL,
      });
      const broadcast = (executed as { broadcast?: BroadcastResultLike })
        ?.broadcast;
      return { proposal, broadcast, awaitingApprovers: false };
    },
    onSuccess: ({ proposal, broadcast, awaitingApprovers }) => {
      const explorerUrl = broadcastExplorerUrl(
        broadcast,
        EVM_RPC_URL,
      );
      const explorerLabel = explorerLabelForChainKind(
        broadcast?.chain_kind,
        EVM_RPC_URL,
      );
      // Prefer the typed ENS name in the success label so the user
      // sees what they wrote ("vitalik.eth") rather than the
      // resolved 0x address.
      const sentTo = ensAddress
        ? trimmedRecipient
        : shortEvmAddress(effectiveRecipient ?? trimmedRecipient);
      setSentLabel({
        amount: amount.trim(),
        to: sentTo,
        explorerUrl,
        explorerLabel,
        pending: awaitingApprovers,
        proposal: awaitingApprovers ? proposal : null,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
      if (awaitingApprovers) {
        setStage("sent");
        return;
      }
      // Persist the success in the per-wallet tx log for the
      // "Recent send attempts" widget - gives the user durable
      // proof of the send instead of a transient toast.
      recordAttempt({
        walletName,
        chainKind: EVM_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: EVM_TICKER,
        recipientShort: sentTo,
        recipientFull: effectiveRecipient ?? undefined,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      // Refresh every place EVM balance is shown so the post-send
      // compose, /chains row, and portfolio panel all reflect the
      // new number. Multiple keys for the same data - each consumer
      // picked its own type/shape; invalidate them all.
      queryClient.invalidateQueries({ queryKey: ["wallet-evm-native-balance"] });
      queryClient.invalidateQueries({ queryKey: ["wallet-eth-balance"] });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-other-chain-balances"],
      });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send-eth]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      // Persist the failure so the user can find the error after
      // the toast disappears. Keep stderr (when available from a
      // BackendApiError payload) for the "Show details" expander.
      const stderr =
        (err as { payload?: { stderr?: string } })?.payload?.stderr ?? undefined;
      recordAttempt({
        walletName,
        chainKind: EVM_CHAIN_KIND,
        status: "failed",
        amountDisplay: amount.trim(),
        ticker: EVM_TICKER,
        recipientShort: effectiveRecipient
          ? ensAddress
            ? trimmedRecipient
            : shortEvmAddress(effectiveRecipient)
          : trimmedRecipient || undefined,
        errorBrief: fe.title,
        errorStderr: stderr ? stderr.slice(0, 800) : undefined,
      });
      setStage("compose");
    },
  });

  const handleSubmit = () => {
    setStage("sending");
    submit.mutate();
  };

  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  // Short-circuit renders for the two pre-flight gates. Bounces are
  // explicit links rather than auto-redirects so the user understands
  // why they were moved.
  if (allLoaded && needsBinding) {
    return (
      <PreFlightCard
        title={`Turn on ${EVM_LABEL}`}
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=${isHyperliquid ? "hyperliquid_evm" : "evm_1559"}&autostart=1`,
          label: `Turn on ${EVM_LABEL}`,
        }}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title={`Turn on ${EVM_LABEL}`}
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/eth${isHyperliquid ? "?network=hyperliquid&autostart=1" : "?autostart=1"}`,
          label: `Turn on ${EVM_LABEL}`,
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="flex flex-1 flex-col">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          {stage === "compose" && (
            <SendChainPicker walletName={walletName} activeKind={EVM_CHAIN_KIND} />
          )}
          {stage === "compose" && policyEvaluation?.matched && (
            <PolicyMatchBanner
              walletName={walletName}
              evaluation={policyEvaluation}
            />
          )}
          {stage === "compose" && (
            <ComposeStage
              walletName={walletName}
              chainKind={EVM_CHAIN_KIND}
              chainLabel={EVM_LABEL}
              ticker={EVM_TICKER}
              walletEthAddress={walletEthAddress}
              amount={amount}
              setAmount={setAmount}
              amountWei={amountWei}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientValid={recipientValid}
              effectiveRecipient={effectiveRecipient}
              ensName={ensAddress ? trimmedRecipient : null}
              ensResolving={ensResolving}
              ensFailed={ensFailed}
              note={note}
              setNote={setNote}
              amountValid={amountValid}
              canSubmit={canSubmit}
              walletBalanceWei={balance}
              balanceLoading={ethBalanceQuery.isLoading}
              insufficientBalance={insufficientBalance}
              gasReserveWei={ETH_GAS_RESERVE_WEI}
              approvalThreshold={ethIntent?.account?.approvalThreshold ?? 1}
              timelockSeconds={ethIntent?.account?.timelockSeconds ?? 0}
              onSubmit={handleSubmit}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && (
            <SendProgressStage
              primary={`Talking to ${EVM_LABEL}...`}
              hint={`Finishing the send on ${EVM_LABEL}.`}
              loaderLabel={`Sending ${EVM_LABEL} request`}
              reduceMotion={!!reduce}
            />
          )}
          {stage === "sent" && sentLabel && (
            <SentStage
              amount={sentLabel.amount}
              to={sentLabel.to}
              explorerUrl={sentLabel.explorerUrl}
              explorerLabel={sentLabel.explorerLabel}
              walletName={walletName}
              walletDisplay={walletDisplay || "your shared wallet"}
              ticker={EVM_TICKER}
              networkLabel={EVM_LABEL}
              pending={sentLabel.pending}
              proposal={sentLabel.proposal}
              reduce={!!reduce}
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}
