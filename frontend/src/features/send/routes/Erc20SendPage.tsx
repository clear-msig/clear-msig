"use client";

// Send an ERC-20 token (Sepolia) - sibling of /send/eth for token
// transfers. The wallet's same Sepolia address (chain_kind=1 binding)
// holds ERC-20 balances; the intent that unlocks the send is
// chain_kind=4 (set up via /setup/erc20). The user picks the token
// per-send by pasting its contract address - one intent unlocks every
// ERC-20 the wallet holds.
//
// Flow:
//   1. Read wallet + EVM binding + ERC-20 intent. Bounce to /setup
//      or /chains/add if either is missing.
//   2. User pastes a token contract → we fetch decimals/symbol via
//      eth_call (lib/chain/erc20.ts) so the amount input + Max are
//      properly scaled.
//   3. User enters recipient (0x…) + amount in token units.
//   4. Frontend pulls the live nonce, encodes
//      [nonce, token_contract, recipient, amount] into the
//      erc20_transfer_sepolia template's params.
//   5. prepare → sign on Solana → submit → execute(broadcast=true)
//      via Ika to broadcast the actual ERC-20 tx to Sepolia.
//
// The wallet's secp256k1 dWallet key signs both ETH transfers and
// ERC-20 calls - same key, different preimage builder. So a single
// chain binding covers both intents.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, List as ListIcon, Loader2, ShieldAlert } from "lucide-react";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import {
  broadcastExplorerUrl,
  explorerLabelForChainKind,
  type BroadcastResultLike,
} from "@/lib/explorer";
import { recordAttempt } from "@/lib/retail/txLog";
import { IntentType, toHex } from "@/lib/msig";
import { encodeParams } from "@/lib/msig/encode";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import {
  fetchEvmNonce,
  isValidEvmAddress,
  shortEvmAddress,
} from "@/lib/chain/eth";
import {
  fetchErc20Balance,
  fetchErc20Metadata,
  isValidErc20Contract,
  tokenAmountToBaseUnits,
  tokenAmountToString,
} from "@/lib/chain/erc20";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { SendProgressStage } from "@/features/send/ui/SendProgressStage";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { RecentRecipientsChips } from "@/components/retail/RecentRecipientsChips";
import { FormField, TextInput } from "@/components/retail/FormField";
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
import {
  clearSignProfileForSigner,
  prepareClearSignAction,
  randomActionLabel,
  textCommitmentHex,
  type ClearSignEnvelope,
  type SendPayload,
} from "@/lib/clearsign";
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
import { liveUsdEstimate } from "@/lib/clearsign/fiatEstimate";
import { ETHEREUM_SEPOLIA_USDC } from "@/lib/chain/stablecoins";
import { ComposeStage } from "@/features/send/ui/evm/Erc20SendStages";
import { PreFlightCard, SentStage } from "@/features/send/ui/evm/Erc20SendResults";

const ERC20_CHAIN_KIND = 4;
const ETH_CHAIN_KIND = 1;

type Stage = "compose" | "sending" | "sent";

export default function SendErc20PageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SendErc20Page />
    </Suspense>
  );
}

function SendErc20Page() {
  const params = useSearchParams();
  const route = useParams<{ name: string }>();
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
    // Force fresh fetch on every mount so users navigating here
    // straight from /setup/erc20 don't see the pre-setup cache and
    // get bounced back into "Enable" UI while the background refetch
    // is still in flight. See the matching note on /send/eth.
    refetchOnMount: "always",
  });
  const chainsQuery = useWalletChains(walletName);

  const erc20Intent = useMemo(() => {
    if (!intentsQuery.data) return null;
    return (
      intentsQuery.data.find(
        (it) =>
          it.account !== null &&
          it.account.intentType === IntentType.Custom &&
          it.account.chainKind === ERC20_CHAIN_KIND,
      ) ?? null
    );
  }, [intentsQuery.data]);
  const ethBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === ETH_CHAIN_KIND,
    );
  }, [chainsQuery.data]);
  const walletEthAddress = ethBinding ? chainAddress(ethBinding) : null;

  // Gate on BOTH isLoading and isFetching so the page doesn't render
  // "Turn on token sending" on stale cache while a background refetch
  // (triggered by refetchOnMount: "always") is still fetching the
  // post-setup intent list. See the matching note on /send/eth.
  const allSettled =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading &&
    !intentsQuery.isFetching &&
    !chainsQuery.isFetching;
  const needsBinding = allSettled && !ethBinding;
  const needsIntent = allSettled && !!ethBinding && !erc20Intent;
  const allLoaded = allSettled;

  const [stage, setStage] = useState<Stage>("compose");
  const [tokenContract, setTokenContract] = useState(
    () => params?.get("token")?.trim() || ETHEREUM_SEPOLIA_USDC.address,
  );
  const [amount, setAmount] = useState(
    () => params?.get("amount")?.trim() ?? "",
  );
  const [recipient, setRecipient] = useState(
    () => params?.get("recipient")?.trim() ?? "",
  );
  const [note, setNote] = useState(() => params?.get("note")?.trim() ?? "");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    symbol: string;
    to: string;
    explorerUrl: string | null;
    explorerLabel: string;
    pending: boolean;
    proposal: string | null;
  } | null>(null);

  const trimmedToken = tokenContract.trim();
  const trimmedRecipient = recipient.trim();
  const tokenContractValid = isValidErc20Contract(trimmedToken);
  const recipientValid = isValidEvmAddress(trimmedRecipient);

  // Token metadata - decimals + symbol + name from the token contract
  // via eth_call. Without this we couldn't scale the user's typed
  // "1.5" into base units, and the post-send confirmation would say
  // "1.5 (unknown token)".
  const tokenMetaQuery = useQuery({
    queryKey: ["erc20-metadata", trimmedToken.toLowerCase()],
    queryFn: () => fetchErc20Metadata(trimmedToken),
    enabled: tokenContractValid,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  const meta = tokenMetaQuery.data ?? null;
  const decimals = meta?.decimals ?? null;
  const symbol = meta?.symbol ?? null;

  // Live token balance for the wallet's Sepolia address. Drives the
  // "Wallet has X.XX TOKEN" caption + the Max button + the
  // insufficient-balance gate.
  const balanceQuery = useQuery({
    queryKey: [
      "wallet-erc20-balance",
      trimmedToken.toLowerCase(),
      walletEthAddress ?? "",
    ],
    queryFn: () => fetchErc20Balance(trimmedToken, walletEthAddress!),
    enabled: tokenContractValid && !!walletEthAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const balance = balanceQuery.data ?? null;
  const balanceLoaded = balanceQuery.isFetched && balance !== null;

  let amountValid = false;
  let amountBase = 0n;
  if (amount.trim() && decimals !== null) {
    try {
      amountBase = tokenAmountToBaseUnits(amount, decimals);
      amountValid = amountBase > 0n;
    } catch {
      amountValid = false;
    }
  }

  const insufficientBalance =
    balanceLoaded && amountValid && balance! < amountBase;

  // Policy-rule pre-flight tripwire (Tier-5 #33). chain_kind=4 for
  // ERC-20; passes the token contract through so per-token rules
  // can scope themselves correctly.
  const policyEvaluation = usePolicyEvaluation({
    walletName,
    chainKind: 4,
    tokenContract: trimmedToken.toLowerCase(),
    recipient: trimmedRecipient,
    ticker: symbol ?? "TOKEN",
    amountDisplay: amount,
    enabled: amountValid && recipientValid && tokenContractValid,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";

  const canSubmit =
    tokenContractValid &&
    !!meta &&
    amountValid &&
    recipientValid &&
    !!erc20Intent &&
    !!walletEthAddress &&
    !!wallet.publicKey &&
    !insufficientBalance &&
    !policyDenied;

  const submit = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!erc20Intent || !erc20Intent.account)
        throw new Error("ERC-20 sending isn't set up for this wallet");
      if (!walletEthAddress)
        throw new Error("Wallet's Ethereum address isn't ready yet");
      if (!tokenContractValid)
        throw new Error("Token contract must be a 0x… 42-character address");
      if (!recipientValid)
        throw new Error("Recipient must be a valid 0x address");
      if (!meta) throw new Error("Couldn't read token metadata yet");

      const proposerPk = wallet.pickSigner(erc20Intent.account.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list. " +
            "Disconnect the Ledger or sign in with the wallet that originally created this multisig.",
        );
      }
      const submitPolicyPlan = await resolvePolicyEnforcement(walletName, {
        walletName,
        chainKind: 4,
        tokenContract: trimmedToken.toLowerCase(),
        recipient: trimmedRecipient,
        ticker: symbol ?? "TOKEN",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(submitPolicyPlan);
      const tokenForClearSign = trimmedToken.toLowerCase();
      const recipientForClearSign = trimmedRecipient.toLowerCase();
      const onchainPolicy = encodeTypedRemoteSendPolicy(submitPolicyPlan, {
        assetTicker: symbol ?? "TOKEN",
        decimals: meta.decimals,
        normalizeRecipient: (value) => value.trim().toLowerCase(),
      });

      const { nonce } = await fetchEvmNonce(walletEthAddress);
      const paramsDataHex = toHex(
        encodeParams(erc20Intent.account, {
          nonce: String(nonce),
          token_contract: tokenForClearSign,
          recipient: recipientForClearSign,
          amount: amountBase.toString(),
        }),
      );
      const actionId = randomActionLabel("erc20-send");
      const actionNonce = randomActionLabel("nonce");
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const policyCommitment =
        onchainPolicy?.commitmentHex ??
        policyCommitmentHexForParts([
          `wallet:${walletQuery.data?.pda.toBase58() ?? walletName}`,
          `intent:${erc20Intent.account.intentIndex}`,
          `chain:${ERC20_CHAIN_KIND}`,
          `threshold:${erc20Intent.account.approvalThreshold ?? ""}`,
          `proposers:${erc20Intent.account.proposers.join(",")}`,
          `approvers:${erc20Intent.account.approvers.join(",")}`,
        ]);
      const envelope: ClearSignEnvelope<SendPayload> = {
        version: 3,
        kind: "send",
        network: "Ethereum Sepolia",
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
          asset: tokenForClearSign,
          assetEncoding: "sha256_text",
          decimals: meta.decimals,
          displayAsset: meta.symbol,
          note: note.trim() || undefined,
          estimatedUsd: liveUsdEstimate(amount, meta.symbol),
        },
      };
      const summary = await prepareClearSignAction(envelope, {
        fallback: false,
        deviceProfile: clearSignProfileForSigner(wallet, proposerPk),
      });
      const dry = await backendApi.prepare.createTypedProposal(walletName, {
        intent_index: erc20Intent.account.intentIndex,
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

      const signed = await signTypedDescriptor(dry, {
        preferSigner: proposerPk,
        expectedTyped: {
          envelopeHash: summary.envelopeHash,
          payloadHash: summary.payloadHash,
          signableText: summary.signableText,
        },
      });

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
      const intent = erc20Intent.account;
      const approverPk = wallet.pickSigner(intent.approvers);

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
        chainKind: 4,
        tokenContract: trimmedToken.toLowerCase(),
        recipient: trimmedRecipient,
        ticker: symbol ?? "TOKEN",
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

      const executed = await backendApi.executeTypedChainSend(walletName, proposal, {
        chainKind: ERC20_CHAIN_KIND,
        amountRaw: amountBase.toString(),
        recipientHash: textCommitmentHex(recipientForClearSign),
        assetIdHash: textCommitmentHex(tokenForClearSign),
        paramsDataHex,
        broadcast: true,
        dwalletProgram: appConfig.preAlpha.dwalletProgramId,
        grpcUrl: appConfig.preAlpha.grpcUrl,
        rpcUrl: appConfig.preAlpha.destinationRpcUrl,
      });
      const broadcast = (executed as { broadcast?: BroadcastResultLike })
        ?.broadcast;
      return { proposal, broadcast, awaitingApprovers: false };
    },
    onSuccess: ({ proposal, broadcast, awaitingApprovers }) => {
      const explorerUrl = broadcastExplorerUrl(
        broadcast,
        appConfig.preAlpha.destinationRpcUrl,
      );
      const explorerLabel = explorerLabelForChainKind(
        broadcast?.chain_kind,
        appConfig.preAlpha.destinationRpcUrl,
      );
      const tickerSafe = symbol ?? "TOKEN";
      setSentLabel({
        amount: amount.trim(),
        symbol: tickerSafe,
        to: shortEvmAddress(trimmedRecipient),
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
      recordAttempt({
        walletName,
        chainKind: ERC20_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: tickerSafe,
        recipientShort: shortEvmAddress(trimmedRecipient),
        recipientFull: trimmedRecipient,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["wallet-erc20-balance"] });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
      queryClient.invalidateQueries({
        queryKey: ["wallet-other-chain-balances"],
      });
      setStage("sent");
    },
    onError: (err) => {
      console.error("[send-erc20]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
      const stderr =
        (err as { payload?: { stderr?: string } })?.payload?.stderr ?? undefined;
      recordAttempt({
        walletName,
        chainKind: ERC20_CHAIN_KIND,
        status: "failed",
        amountDisplay: amount.trim(),
        ticker: symbol ?? "TOKEN",
        recipientShort: trimmedRecipient
          ? shortEvmAddress(trimmedRecipient)
          : undefined,
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

  if (allLoaded && needsBinding) {
    return (
      <PreFlightCard
        title="Turn on token sending"
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=evm_1559&next=erc20&autostart=1`,
          label: "Turn on token sending",
        }}
      />
    );
  }
  if (allLoaded && needsIntent) {
    return (
      <PreFlightCard
        title="Turn on token sending"
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(walletName)}/setup/erc20?autostart=1`,
          label: "Turn on token sending",
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
            <SendChainPicker
              walletName={walletName}
              activeKind={ERC20_CHAIN_KIND}
            />
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
              walletEthAddress={walletEthAddress}
              tokenContract={tokenContract}
              setTokenContract={setTokenContract}
              tokenContractValid={tokenContractValid}
              metadata={meta}
              metadataLoading={tokenContractValid && tokenMetaQuery.isLoading}
              metadataError={tokenContractValid && !!tokenMetaQuery.error}
              amount={amount}
              setAmount={setAmount}
              amountBase={amountBase}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientValid={recipientValid}
              note={note}
              setNote={setNote}
              amountValid={amountValid}
              canSubmit={canSubmit}
              walletBalance={balance}
              balanceLoading={balanceQuery.isLoading}
              insufficientBalance={insufficientBalance}
              approvalThreshold={erc20Intent?.account?.approvalThreshold ?? 1}
              timelockSeconds={erc20Intent?.account?.timelockSeconds ?? 0}
              onSubmit={handleSubmit}
              reduce={!!reduce}
            />
          )}
          {stage === "sending" && (
            <SendProgressStage
              primary="Sending token request..."
              hint="Finishing the send on Sepolia."
              loaderLabel="Sending token request"
              reduceMotion={!!reduce}
            />
          )}
          {stage === "sent" && sentLabel && (
            <SentStage
              amount={sentLabel.amount}
              symbol={sentLabel.symbol}
              to={sentLabel.to}
              explorerUrl={sentLabel.explorerUrl}
              explorerLabel={sentLabel.explorerLabel}
              walletName={walletName}
              walletDisplay={walletDisplay || "your shared wallet"}
              reduce={!!reduce}
              pending={sentLabel.pending}
              proposal={sentLabel.proposal}
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}
