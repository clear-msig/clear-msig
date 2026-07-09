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
  encodeTypedRemoteSendPolicy,
  policyCommitmentHexForParts,
} from "@/lib/policies/onchain";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { BrandLoader } from "@/components/retail/BrandLoader";
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

type Stage = "compose" | "sending" | "sent";

// Strip an EIP-681 / wallet-scheme prefix from a scanned QR. We
// don't fully parse the URI (chain id + value query params); the
// recipient field cares about the address. Anything we can't
// recognise passes through unchanged so the user can paste raw
// content too.
function parseEvmRecipientFromQr(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  // ethereum:0x… or pay-ethereum:0x… (EIP-681).
  const m = trimmed.match(/^(?:pay-)?ethereum:(0x[0-9a-fA-F]{40})/);
  if (m) return m[1];
  // Otherwise let the input field's existing validation surface
  // any issues - better to pass through than silently swallow.
  return trimmed;
}

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
      const onchainPolicy = encodeTypedRemoteSendPolicy(submitPolicyPlan, {
        assetTicker: EVM_TICKER,
        decimals: 18,
        normalizeRecipient: (value) => value.trim().toLowerCase(),
      });

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
          amount: amountWei.toString(),
          asset: EVM_TICKER,
          assetEncoding: "sha256_text",
          note: note.trim() || undefined,
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
      const signed = await signTypedDescriptor(dry, { preferSigner: proposerPk });

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
      return { proposal, broadcast };
    },
    onSuccess: ({ broadcast }) => {
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
      });
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
      queryClient.invalidateQueries({ queryKey: ["proposals", walletName] });
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
              onSubmit={handleSubmit}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && (
            <SendingStage reduce={!!reduce} label={EVM_LABEL} />
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
              reduce={!!reduce}
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}

// ─── Compose stage ────────────────────────────────────────────────

interface ComposeStageProps {
  walletName: string;
  chainKind: number;
  chainLabel: string;
  ticker: string;
  walletEthAddress: string | null;
  amount: string;
  setAmount: (s: string) => void;
  amountWei: bigint;
  recipient: string;
  setRecipient: (s: string) => void;
  recipientValid: boolean;
  /// The 0x address we'll actually sign + broadcast against -
  /// either the typed 0x or the ENS-resolved one. Null while
  /// the user is typing.
  effectiveRecipient: string | null;
  /// The .eth name the user typed, when we successfully
  /// resolved it. Null when the user pasted a raw 0x address.
  ensName: string | null;
  /// True while the ENS proxy is in flight.
  ensResolving: boolean;
  /// True when the typed text looked like an ENS name but the
  /// proxy returned no record.
  ensFailed: boolean;
  note: string;
  setNote: (s: string) => void;
  amountValid: boolean;
  canSubmit: boolean;
  walletBalanceWei: bigint | null;
  balanceLoading: boolean;
  insufficientBalance: boolean;
  gasReserveWei: bigint;
  onSubmit: () => void;
  reduce: boolean;
}

function ComposeStage({
  walletName,
  chainKind,
  chainLabel,
  ticker,
  walletEthAddress,
  amount,
  setAmount,
  amountWei,
  recipient,
  setRecipient,
  recipientValid,
  effectiveRecipient,
  ensName,
  ensResolving,
  ensFailed,
  note,
  setNote,
  amountValid,
  canSubmit,
  walletBalanceWei,
  balanceLoading,
  insufficientBalance,
  gasReserveWei,
  onSubmit,
}: ComposeStageProps) {
  const walletDisplay = toDisplayName(walletName);
  const ethMeta = chainByKind(chainKind);

  const previewDetails: SignPayloadDetail[] = [
    { label: "From wallet", value: toDisplayName(walletName) || "your wallet" },
    { label: "Chain", value: chainLabel },
    walletEthAddress
      ? {
          label: "From address",
          value: shortEvmAddress(walletEthAddress),
          emphasis: "mono",
        }
      : { label: "From address", value: "spinning up" },
  ];
  if (recipientValid && effectiveRecipient) {
    previewDetails.push({
      label: "Recipient",
      value: shortEvmAddress(effectiveRecipient),
      emphasis: "mono",
    });
    if (ensName) {
      previewDetails.push({ label: "ENS name", value: ensName });
    }
  }
  if (amountValid) {
    previewDetails.push({
      label: "Amount",
      value: `${amount.trim()} ${ticker}`,
      emphasis: "amount",
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Compact left-aligned header. Matches SOL /send. Chain badge
          inline with eyebrow + display title; "From {wallet}" sits on
          the right edge so the network identity is unmistakable
          without burning vertical space. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-3">
          {ethMeta ? <ChainBadge chain={ethMeta} size="md" /> : null}
          <div className="flex flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Send
            </p>
            <h1 className="hidden font-display text-2xl font-semibold leading-tight text-text-strong md:block">
              Send {ticker}
            </h1>
          </div>
        </div>
        <p className="text-xs text-text-soft sm:text-sm">
          From{" "}
          <span className="font-medium text-text-strong">{walletDisplay}</span>
        </p>
      </header>

      {chainKind === 1 || chainKind === 4 ? (
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/send/erc20`}
          className={
            "inline-flex min-h-tap w-fit items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-4 py-2 text-xs font-medium text-text-soft " +
            "transition-[border-color,color,transform] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          Send a token instead (USDC, DAI, …)
        </Link>
      ) : null}

      {/* Compose grid. Amount + Recipient sit side-by-side on lg+
          and merge into one bordered card on mobile. Same shell as
          SOL /send and BTC /send/btc. */}
      <div
        className={
          "flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
          "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 " +
          "lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        }
      >
        {/* Amount card. Balance + Max live with the input so the
            number, asset, and available balance stay visually scoped. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <SendAmountField
            id="send-eth-amount-input"
            ticker={ticker}
            value={amount}
            onChange={(e) => {
              const stripped = e.target.value.replace(/[^\d.]/g, "");
              const [whole = "", frac] = stripped.split(".");
              const next =
                frac === undefined
                  ? whole.slice(0, 12)
                  : `${whole.slice(0, 12)}.${frac.slice(0, 18)}`;
              setAmount(next);
            }}
            autoFocus
            maxLength={20}
            action={
              typeof walletBalanceWei === "bigint" &&
              walletBalanceWei > 0n ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    const max =
                      walletBalanceWei > gasReserveWei
                        ? walletBalanceWei - gasReserveWei
                        : 0n;
                    setAmount(weiToEth(max, 12));
                  }}
                  className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
                >
                  Use max
                </button>
              ) : null
            }
            footer={
              <>
                <span>Wallet has </span>
                <span className="font-numerals font-medium text-text-strong tabular-nums">
                  {balanceLoading
                    ? "..."
                    : typeof walletBalanceWei === "bigint"
                      ? weiToEth(walletBalanceWei)
                      : "-"}
                </span>
                <span> {ticker}</span>
                {typeof walletBalanceWei === "bigint" &&
                  walletBalanceWei > 0n && (
                    <UsdHint
                      amount={walletBalanceWei}
                      smallestPerWhole={1_000_000_000_000_000_000n}
                      ticker={ticker}
                    />
                  )}
                {amount.trim() && !amountValid && (
                  <span className="ml-1.5 text-warning">
                    Must be a positive number.
                  </span>
                )}
              </>
            }
            warning={
              insufficientBalance && walletBalanceWei !== null ? (
                <>
                  <span className="font-medium">Insufficient balance.</span>{" "}
                  You have {weiToEth(walletBalanceWei)} {ticker}
                  <UsdHint
                    amount={walletBalanceWei}
                    smallestPerWhole={1_000_000_000_000_000_000n}
                    ticker={ticker}
                  />
                  {" "}, need at least {weiToEth(amountWei + gasReserveWei)}{" "}
                  {ticker} including ~{weiToEth(gasReserveWei)} for gas.
                </>
              ) : null
            }
          />
        </section>

        {/* Recipient + Note card. Same merged-mobile / split-lg+
            treatment as Amount above. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <Field
            label="To"
            hint={
              recipient.trim() && !recipientValid && !ensResolving && ensFailed
                ? "Couldn’t resolve that ENS name. Paste a 0x address instead."
                : recipient.trim() && !recipientValid && !ensResolving
                  ? `Must be a 0x… 42-character ${chainLabel} address or a .eth name.`
                  : undefined
            }
          >
            <div className="flex items-stretch gap-2">
              <TextInput
                type="text"
                value={recipient}
                onChange={(e) => setRecipient(e.target.value)}
                placeholder="0x… or vitalik.eth"
                className="flex-1 font-mono"
              />
              <QrScanButton
                ariaLabel="Scan recipient QR"
                title="Scan a recipient QR"
                onResult={(v) => setRecipient(parseEvmRecipientFromQr(v))}
                className={
                  "shrink-0 inline-flex h-auto items-center justify-center rounded-card border border-border-soft bg-canvas px-3 text-text-soft " +
                  "transition-[border-color,color,transform] duration-base ease-out-soft " +
                  "hover:-translate-y-0.5 hover:text-accent " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                }
              />
            </div>
            {ensResolving && (
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-text-soft">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Resolving {recipient.trim()}…
              </span>
            )}
            {ensName && effectiveRecipient && !ensResolving && (
              <span className="mt-2 inline-flex items-center gap-1.5 text-xs text-accent">
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Resolved {ensName} ·{" "}
                <span className="font-mono text-text-soft">
                  {shortEvmAddress(effectiveRecipient)}
                </span>
              </span>
            )}
          </Field>

          <RecentRecipientsChips
            walletName={walletName}
            chainKind={chainKind}
            onPick={(addr) => setRecipient(addr)}
          />

          <Field label={SEND_NOTE_LABEL}>
            <TextInput
              type="text"
              value={note}
              onChange={(e) =>
                setNote(e.target.value.slice(0, SEND_NOTE_MAX_LENGTH))
              }
              placeholder={SEND_NOTE_PLACEHOLDER}
              maxLength={SEND_NOTE_MAX_LENGTH}
            />
          </Field>
        </section>
      </div>

      {/* Preview + popup narration. Info-icon mode so the headline +
          warning stay visible and the secondary context is one
          hover/tap away. Same pattern as SOL /send. */}
      <div className="flex flex-col gap-2">
        <SignPayloadPreview
          action={
            amountValid && recipientValid && effectiveRecipient
              ? `Send ${amount.trim()} ${ticker} to ${
                  ensName ?? shortEvmAddress(effectiveRecipient)
                }`
              : "Fill in the amount and recipient above"
          }
          details={previewDetails}
          collapsibleDetails
        />
      </div>

      {/* Action footer. Sticky CTA mirrors the other send pages. */}
      <div className="flex flex-col gap-2 pt-1">
        <div
          className={
            "-mx-3 sm:mx-0 px-3 sm:px-0 " +
            "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
            "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
          }
        >
          <Button size="lg" fullWidth disabled={!canSubmit} onClick={onSubmit}>
            Send request
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <FormField label={label} error={hint} as="div">
      {children}
    </FormField>
  );
}

// ─── Sending + sent stages ────────────────────────────────────────

function SendingStage({
  reduce,
  label,
}: {
  reduce: boolean;
  label: string;
}) {
  const motionProps = reduce
    ? { initial: false as const, animate: { opacity: 1 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col items-center text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-raised shadow-card-rest">
        <BrandLoader size={32} label={`Sending ${label} request`} />
      </div>
      <p className="mt-5 text-base text-text-strong">Talking to {label}…</p>
      <p className="mt-1 text-xs text-text-soft">
        Finishing the send on {label}.
      </p>
    </motion.section>
  );
}

interface SentStageProps {
  amount: string;
  to: string;
  explorerUrl: string | null;
  explorerLabel: string;
  walletName: string;
  walletDisplay: string;
  ticker: string;
  networkLabel: string;
  reduce: boolean;
}

function SentStage({
  amount,
  to,
  explorerUrl,
  explorerLabel,
  walletName,
  walletDisplay,
  ticker,
  networkLabel,
  reduce,
}: SentStageProps) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: networkLabel },
  ];
  return (
    <SendReceipt
      status="confirmed"
      statusLabel={`Confirmed on ${networkLabel}`}
      amount={amount}
      ticker={ticker}
      recipientLabel={to}
      details={details}
      explorerHref={explorerUrl}
      explorerLabel={explorerLabel}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/send/eth${networkLabel === "Hyperliquid" ? "?network=hyperliquid" : ""}`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See approvals coming in.",
          href: `/app/wallet/${encodeURIComponent(walletName)}`,
          icon: ListIcon,
        },
      ]}
      reduce={reduce}
    />
  );
}

// ─── Pre-flight cards (binding / intent missing) ──────────────────

function PreFlightCard({
  title,
  body,
  cta,
}: {
  title: string;
  body?: string;
  cta: { href: string; label: string };
}) {
  return (
    <div className="flex flex-1 items-center justify-center px-gutter py-10">
      <div className="w-full max-w-md rounded-card border border-warning/30 bg-warning/5 p-6 text-center shadow-card-rest">
        <div className="flex justify-center text-warning">
          <ShieldAlert className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="mt-3 font-display text-display-xs text-text-strong">
          {title}
        </h2>
        {body ? <p className="mt-2 text-sm text-text-soft">{body}</p> : null}
        <Link href={cta.href} className="mt-4 inline-block">
          <Button size="md">
            {cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
