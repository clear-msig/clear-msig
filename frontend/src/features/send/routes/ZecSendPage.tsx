"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType, toHex } from "@/lib/msig";
import { encodeParams } from "@/lib/msig/encode";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  waitForProposalApproval,
} from "@/lib/chain/proposals";
import { toDisplayName } from "@/lib/retail/walletNames";
import { backendApi } from "@/lib/api/endpoints";
import { friendlyError } from "@/lib/api/errors";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendProgressStage } from "@/features/send/ui/SendProgressStage";
import {
  SignPayloadPreview,
  type SignPayloadDetail,
} from "@/components/retail/SignPayloadPreview";
import {
  SendReceipt,
  type ReceiptDetail,
} from "@/components/retail/SendReceipt";
import { UsdHint } from "@/components/retail/UsdHint";
import { SendChainPicker } from "@/components/retail/SendChainPicker";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { FormField, TextInput } from "@/components/retail/FormField";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import {
  assertPolicyNotDenied,
  resolvePolicyEnforcement,
} from "@/lib/policies/enforce";
import {
  policyCommitmentHexForParts,
} from "@/lib/policies/onchain";
import { resolvePersistentSendPolicy } from "@/lib/policies/persistentWalletPolicy";
import {
  pkhClearSignRecipient,
  prepareClearSignAction,
  randomActionLabel,
  textCommitmentHex,
  type ClearSignEnvelope,
  type SendPayload,
} from "@/lib/clearsign-v2";
import { chainByKind } from "@/lib/retail/chains";
import { appConfig, configuredBrowserRpcUrl } from "@/lib/config";
import {
  ZCASH_SEND_FEE_RESERVE_ZATS,
  decodeZcashTransparentAddress,
  fetchZcashBalance,
  fetchZcashUtxos,
  networkForZcashAddress,
  selectZcashNoChangeUtxo,
  validateZcashDestination,
} from "@/lib/chain/zcash";
import { parseBtcAmount, formatSats, reverseHex } from "@/lib/chain/btc";
import { shortEvmAddress } from "@/lib/chain/eth";
import { recordAttempt } from "@/lib/retail/txLog";
import { broadcastExplorerUrl, explorerLabelForChainKind } from "@/lib/explorer";
import {
  SEND_NOTE_LABEL,
  SEND_NOTE_MAX_LENGTH,
  SEND_NOTE_PLACEHOLDER,
} from "@/lib/sendFields";
import { liveUsdEstimate } from "@/lib/clearsign-v2/fiatEstimate";
import { PreFlightCard, SentStage, ZcashAwaitingApproval, ZcashCompose } from "@/features/send/ui/zcash/ZcashSendStages";

const ZEC_TEMPLATE = "examples/intents/zcash_transfer.json";
const ZEC_CHAIN_KIND = 3;

export default function ZcashSendPage() {
  const params = useParams<{ name: string }>();
  const searchParams = useSearchParams();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { signDescriptor, signTypedDescriptor } = useSignWithWallet();
  const toast = useToast();
  const queryClient = useQueryClient();
  const walletDisplay = toDisplayName(name);

  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
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
    refetchOnMount: "always",
  });
  const chainsQuery = useWalletChains(name);
  const zcashBinding = useMemo(
    () => (chainsQuery.data?.chains ?? []).find((b) => b.chain_kind === ZEC_CHAIN_KIND) ?? null,
    [chainsQuery.data],
  );
  const zcashAddress = zcashBinding ? chainAddress(zcashBinding) : null;
  const senderDecoded = zcashAddress ? decodeZcashTransparentAddress(zcashAddress) : null;
  const zcashNetwork = zcashAddress ? networkForZcashAddress(zcashAddress) ?? "testnet" : "testnet";
  const zcashRpcUrl = configuredBrowserRpcUrl(appConfig.preAlpha.zcashRpcUrl);

  const zcashIntent = useMemo(() => {
    return (intentsQuery.data ?? [])
      .map((it) => it.account)
      .find(
        (a) =>
          a !== null &&
          a.intentType === IntentType.Custom &&
          a.chainKind === ZEC_CHAIN_KIND,
      );
  }, [intentsQuery.data]);

  const allSettled =
    !walletQuery.isLoading &&
    !intentsQuery.isLoading &&
    !chainsQuery.isLoading &&
    !intentsQuery.isFetching &&
    !chainsQuery.isFetching;
  const needsBinding = allSettled && !zcashBinding;
  const needsIntent = allSettled && !!zcashBinding && !zcashIntent;
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(() => searchParams?.get("note")?.trim() ?? "");
  const [sentLabel, setSentLabel] = useState<{
    amount: string;
    to: string;
    note: string;
    explorerUrl: string | null;
    explorerLabel: string;
  } | null>(null);
  const [awaitingApproval, setAwaitingApproval] = useState<{
    amount: string;
    to: string;
    proposal: string;
  } | null>(null);
  const [autoStartedSetup, setAutoStartedSetup] = useState(false);
  const autoStartSetup = searchParams?.get("autostart") === "1";

  const recipientDecoded = useMemo(
    () => validateZcashDestination(recipient),
    [recipient],
  );
  const recipientValid = recipientDecoded.ok;
  const effectiveRecipient = recipientValid ? recipientDecoded.pkh : null;
  const amountZats = useMemo(() => parseBtcAmount(amount), [amount]);
  const amountValid = amountZats !== null && amountZats > 0n;

  const balanceQuery = useQuery({
    queryKey: ["zcash-balance", zcashAddress ?? "", zcashNetwork, zcashRpcUrl ?? "unconfigured"],
    queryFn: () =>
      zcashAddress && zcashRpcUrl ? fetchZcashBalance(zcashRpcUrl, zcashAddress) : 0n,
    enabled: !!zcashAddress && !!zcashRpcUrl,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const utxosQuery = useQuery({
    queryKey: ["zcash-utxos", zcashAddress ?? "", zcashNetwork, zcashRpcUrl ?? "unconfigured"],
    queryFn: () =>
      zcashAddress && zcashRpcUrl ? fetchZcashUtxos(zcashRpcUrl, zcashAddress) : [],
    enabled: !!zcashAddress && !!zcashRpcUrl,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: 1,
  });
  const zcashBalance = balanceQuery.data ?? null;
  const sendSelection = useMemo(() => {
    if (!amountValid || !amountZats || !utxosQuery.data) return null;
    return selectZcashNoChangeUtxo(utxosQuery.data, amountZats);
  }, [amountValid, amountZats, utxosQuery.data]);
  const selectedUtxo = sendSelection?.utxo ?? null;
  const impliedFeeZats = sendSelection?.impliedFeeZats ?? null;
  const zcashFeeBurnRisk = sendSelection?.feeBurnRisk ?? false;
  const insufficientBalance =
    zcashBalance !== null &&
    amountValid &&
    amountZats !== null &&
    zcashBalance < amountZats + ZCASH_SEND_FEE_RESERVE_ZATS;

  const policyEvaluation = usePolicyEvaluation({
    walletName: name,
    chainKind: ZEC_CHAIN_KIND,
    recipient: recipient,
    ticker: "ZEC",
    amountDisplay: amount,
    enabled: amountValid && recipientValid,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";

  const setup = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!zcashBinding) throw new Error("Bind Zcash to this wallet first");
      const addIntent = (intentsQuery.data ?? []).find(
        (it) => it.account?.intentType === IntentType.AddIntent,
      );
      const signerPk = addIntent?.account
        ? wallet.pickSigner(addIntent.account.proposers)
        : wallet.publicKey;
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list.",
        );
      }
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify([signerPk.toBase58()])), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify([signerPk.toBase58()])), fheType: "ebytes" },
        { plaintext: new Uint8Array([1]), fheType: "euint8" },
        { plaintext: new Uint8Array([0]), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");
      const dry = await backendApi.prepare.addIntent(name, {
        file: ZEC_TEMPLATE,
        proposers: [signerPk.toBase58()],
        approvers: [signerPk.toBase58()],
        threshold: 1,
        cancellation_threshold: 1,
        timelock: 0,
        policy_ciphertexts,
      });
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      const submitted = await backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: ZEC_TEMPLATE,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address from setup");
      }
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approverPk = addIntent?.account
          ? wallet.pickSigner(addIntent.account.approvers)
          : signerPk;
        if (!approverPk) {
          throw new Error(
            "The setup proposal landed, but none of your connected wallets can approve it.",
          );
        }
        const approveDry = await backendApi.prepare.approveProposal(name, proposal, {
          actor_pubkey: approverPk.toBase58(),
        });
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      await backendApi.executeProposal(name, proposal, {});
      return proposal;
    },
    onSuccess: () => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: ["wallet-intents"] }),
        queryClient.invalidateQueries({ queryKey: ["wallet", name] }),
        queryClient.refetchQueries({ queryKey: ["wallet-intents"] }),
      ]).then(() => {
        toast.success(`${walletDisplay} can now send ZEC`);
      });
    },
    onError: (err) => {
      console.error("[setup-zec]", err);
      const fe = friendlyError(err, "set-up-spending");
      toast.error(fe.title, { details: fe.body });
    },
  });

  useEffect(() => {
    if (!autoStartSetup || autoStartedSetup || !needsIntent) return;
    if (setup.isPending || setup.isSuccess) return;
    setAutoStartedSetup(true);
    setup.mutate();
  }, [autoStartSetup, autoStartedSetup, needsIntent, setup]);

  const send = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!zcashIntent) {
        throw new Error("Zcash sending isn't set up for this wallet");
      }
      if (!zcashAddress || !senderDecoded) {
        throw new Error("Wallet's Zcash address isn't ready yet");
      }
      if (!zcashRpcUrl) {
        throw new Error("Zcash RPC is not configured for this deployment");
      }
      if (!amountValid || !amountZats) throw new Error("Enter an amount");
      if (!recipientValid || !effectiveRecipient) {
        throw new Error("Recipient must be a valid transparent Zcash address");
      }
      if (!selectedUtxo) {
        throw new Error("No UTXO large enough to cover the send amount");
      }
      if (
        zcashFeeBurnRisk ||
        impliedFeeZats !== ZCASH_SEND_FEE_RESERVE_ZATS
      ) {
        throw new Error(
          "This Zcash input would spend the remainder as fee. Enter the input amount minus the fixed fee.",
        );
      }
      if (recipientDecoded.network !== zcashNetwork) {
        throw new Error("Recipient network does not match the wallet's Zcash network");
      }
      const submitPolicyPlan = await resolvePolicyEnforcement(name, {
        walletName: name,
        chainKind: ZEC_CHAIN_KIND,
        recipient,
        ticker: "ZEC",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(submitPolicyPlan);
      const proposerPk = wallet.pickSigner(zcashIntent.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list.",
        );
      }

      const committedRecipient = pkhClearSignRecipient(
        "zcash-transparent",
        effectiveRecipient,
      );
      const walletPda = walletQuery.data?.pda;
      if (!walletPda) throw new Error("Wallet is still loading. Try again.");
      const onchainPolicy = await resolvePersistentSendPolicy(
        connection,
        walletPda,
        name,
        ZEC_CHAIN_KIND,
      );
      const paramsDataHex = toHex(
        encodeParams(zcashIntent, {
          prev_txid: `0x${reverseHex(selectedUtxo.txid)}`,
          prev_vout: String(selectedUtxo.vout),
          prev_amount_zat: selectedUtxo.satoshis.toString(),
          sender_pkh: `0x${bytesToHex(senderDecoded.pkh)}`,
          recipient_pkh: `0x${bytesToHex(effectiveRecipient)}`,
          send_amount_zat: amountZats.toString(),
        }),
      );
      const actionId = randomActionLabel("zec-send");
      const actionNonce = randomActionLabel("nonce");
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const policyCommitment =
        onchainPolicy?.commitmentHex ??
        policyCommitmentHexForParts([
          `wallet:${walletQuery.data?.pda.toBase58() ?? name}`,
          `intent:${zcashIntent.intentIndex}`,
          `chain:${ZEC_CHAIN_KIND}`,
          `threshold:${zcashIntent.approvalThreshold ?? ""}`,
          `proposers:${zcashIntent.proposers.join(",")}`,
          `approvers:${zcashIntent.approvers.join(",")}`,
        ]);
      const envelope: ClearSignEnvelope<SendPayload> = {
        version: 2,
        kind: "send",
        walletName: name,
        walletId: walletQuery.data?.pda.toBase58(),
        actionId,
        nonce: actionNonce,
        expiresAt,
        policyCommitment,
        payload: {
          recipient: committedRecipient,
          recipientEncoding: "sha256_text",
          amount: amount.trim(),
          asset: "ZEC",
          assetEncoding: "sha256_text",
          note: note.trim() || undefined,
          estimatedUsd: liveUsdEstimate(amount, "ZEC"),
        },
      };
      const summary = await prepareClearSignAction(envelope, {
        fallback: false,
      });
      const dry = await backendApi.prepare.createTypedProposal(name, {
        intent_index: zcashIntent.intentIndex,
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
      const submitted = await backendApi.submit.createTypedProposal(name, {
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
      const decision = await approveIfNeeded(connection, proposal, {
        approvers: zcashIntent.approvers,
        approverPubkey: wallet.pickSigner(zcashIntent.approvers)?.toBase58() ?? null,
        approvalThreshold: zcashIntent.approvalThreshold,
      });
      if (decision.needsApproveSignature) {
        const approverPk = wallet.pickSigner(zcashIntent.approvers);
        if (!approverPk) {
          throw new Error(
            "The proposal landed, but none of your connected wallets can approve it.",
          );
        }
        const approveDry = await backendApi.prepare.approveTypedProposal(name, proposal, {
          actor_pubkey: approverPk.toBase58(),
        });
        const approveSigned = await signTypedDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveTypedProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      const policyPlan = await resolvePolicyEnforcement(name, {
        walletName: name,
        chainKind: ZEC_CHAIN_KIND,
        recipient,
        ticker: "ZEC",
        amountDisplay: amount,
      });
      assertPolicyNotDenied(policyPlan);
      if (policyPlan.evaluation?.matched) {
        if (policyPlan.rule?.action === "require-extra-approvers") {
          const seen = new Set<string>([
            proposerPk.toBase58(),
            wallet.pickSigner(zcashIntent.approvers)?.toBase58() ?? "",
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
            if (!zcashIntent.approvers.includes(extraApprover)) {
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
            const extraDry = await backendApi.prepare.approveTypedProposal(name, proposal, {
              actor_pubkey: extraSigner.toBase58(),
            });
            const extraSigned = await signTypedDescriptor(extraDry, {
              preferSigner: extraSigner,
            });
            await backendApi.submit.approveTypedProposal(name, proposal, {
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
      const executed = await backendApi.executeTypedChainSend(name, proposal, {
        chainKind: ZEC_CHAIN_KIND,
        amountRaw: amountZats.toString(),
        recipientHash: textCommitmentHex(committedRecipient),
        assetIdHash: textCommitmentHex("ZEC"),
        paramsDataHex,
        broadcast: true,
        dwalletProgram: appConfig.preAlpha.dwalletProgramId,
        grpcUrl: appConfig.preAlpha.grpcUrl,
        rpcUrl: zcashRpcUrl,
      });
      const broadcast = (executed as { broadcast?: { chain_kind?: number; tx_id?: string } })
        ?.broadcast;
      return { proposal, broadcast, awaitingApprovers: false };
    },
    onSuccess: ({ proposal, broadcast, awaitingApprovers }) => {
      if (awaitingApprovers) {
        setAwaitingApproval({
          amount: amount.trim(),
          to: recipient,
          proposal,
        });
        toast.success("Zcash request created", {
          details: "It is waiting for the remaining approval before broadcast.",
        });
        queryClient.invalidateQueries({ queryKey: ["proposals", name] });
        return;
      }
      const explorerUrl = broadcastExplorerUrl(broadcast, zcashRpcUrl ?? "");
      const explorerLabel = explorerLabelForChainKind(broadcast?.chain_kind, zcashRpcUrl ?? "");
      const recipientText = recipient;
      setSentLabel({
        amount: amount.trim(),
        to: recipientText,
        note: note.trim(),
        explorerUrl,
        explorerLabel,
      });
      recordAttempt({
        walletName: name,
        chainKind: ZEC_CHAIN_KIND,
        status: "success",
        amountDisplay: amount.trim(),
        ticker: "ZEC",
        recipientShort: recipientText,
        recipientFull: recipientText,
        txId: broadcast?.tx_id,
        explorerUrl: explorerUrl ?? undefined,
      });
      queryClient.invalidateQueries({ queryKey: ["proposals", name] });
      queryClient.invalidateQueries({ queryKey: ["wallet-other-chain-balances"] });
      queryClient.invalidateQueries({ queryKey: ["chain-balance"] });
    },
    onError: (err) => {
      console.error("[send-zec]", err);
      const fe = friendlyError(err, "send");
      toast.error(fe.title, { details: fe.body });
    },
  });

  if (allSettled && needsBinding) {
    return (
      <PreFlightCard
        title="Turn on Zcash"
        body=""
        cta={{
          href: `/app/wallet/${encodeURIComponent(name)}/chains/add?chain=zcash_transparent&autostart=1`,
          label: "Turn on Zcash",
        }}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <div className="flex flex-1 flex-col">
        <motion.section
          initial={reduce ? false : { opacity: 0, y: 12 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="w-full"
        >
          {!send.isPending && !sentLabel && !awaitingApproval && (
            <SendChainPicker walletName={name} activeKind={ZEC_CHAIN_KIND} />
          )}
          {!send.isPending && !sentLabel && !awaitingApproval && policyEvaluation?.matched && (
            <PolicyMatchBanner walletName={name} evaluation={policyEvaluation} />
          )}
          {!send.isPending && !sentLabel && !awaitingApproval && needsIntent && (
            <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-text-soft">
                Turn on Zcash
              </p>
              <p className="mt-2 text-sm text-text-soft">
                Finish setup to unlock Zcash sends.
              </p>
              <Button size="lg" fullWidth className="mt-4" onClick={() => setup.mutate()} disabled={setup.isPending || !zcashBinding}>
                {setup.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Enabling
                  </>
                ) : (
                  <>
                    Turn on Zcash
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </>
                )}
              </Button>
            </div>
          )}
          {!send.isPending && !sentLabel && !awaitingApproval && !needsIntent && (
            <ZcashCompose
              walletDisplay={walletDisplay}
              walletAddress={zcashAddress}
              balance={zcashBalance}
              balanceLoading={balanceQuery.isLoading || utxosQuery.isLoading}
              balanceError={balanceQuery.error ?? utxosQuery.error ?? null}
              amount={amount}
              setAmount={setAmount}
              note={note}
              setNote={setNote}
              recipient={recipient}
              setRecipient={setRecipient}
              recipientDecoded={recipientDecoded}
              amountValid={amountValid}
              recipientValid={recipientValid}
              selectedUtxo={selectedUtxo}
              impliedFeeZats={impliedFeeZats}
              zcashFeeBurnRisk={zcashFeeBurnRisk}
              insufficientBalance={insufficientBalance}
              zcashRpcConfigured={!!zcashRpcUrl}
              approvalThreshold={zcashIntent?.approvalThreshold ?? 1}
              timelockSeconds={zcashIntent?.timelockSeconds ?? 0}
              canSubmit={!policyDenied && !!zcashRpcUrl && amountValid && recipientValid && !!selectedUtxo && !insufficientBalance && !zcashFeeBurnRisk && !!wallet.publicKey}
              onSubmit={() => send.mutate()}
            />
          )}
          {send.isPending && (
            <SendProgressStage
              primary="Talking to Zcash..."
              hint="Finishing the send on Zcash."
              loaderLabel="Sending Zcash request"
            />
          )}
          {sentLabel && (
            <SentStage
              walletName={name}
              walletDisplay={walletDisplay}
              amount={sentLabel.amount}
              to={sentLabel.to}
              note={sentLabel.note}
              explorerUrl={sentLabel.explorerUrl}
              explorerLabel={sentLabel.explorerLabel}
            />
          )}
          {awaitingApproval && (
            <ZcashAwaitingApproval
              request={awaitingApproval}
              walletName={name}
              walletDisplay={walletDisplay}
              onAnother={() => {
                setAwaitingApproval(null);
                setAmount("");
                setRecipient("");
                setNote("");
              }}
            />
          )}
        </motion.section>
      </div>
    </div>
  );
}


function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
