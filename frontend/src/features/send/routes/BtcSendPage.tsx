"use client";

// Bitcoin (P2WPKH) send + setup, fused into one page.
//
// Mirrors the eth flow's two halves (`/setup/eth` then `/send/eth`)
// in a single component because Bitcoin's intent template is fixed
// (single-input, explicit change output/fee) and
// the user has no decisions to make at setup time. Showing two pages
// for "register the intent" + "use the intent" was overhead with no
// payoff.
//
// Pre-flight gates (in order):
//   1. Wallet bound to Bitcoin? If no → "/chains/add?chain=bitcoin_p2wpkh".
//   2. BTC 8-param `Custom` intent exists on the wallet? If no →
//      register one via the standard add-intent meta proposal flow +
//      auto-execute.
//   3. dWallet has UTXOs >= amount + min fee? If no → fund-the-vault
//      copy with the deposit address.
//
// Send flow:
//   1. User enters destination (bech32) + amount.
//   2. We auto-pick one UTXO that covers the amount + a
//      conservative fee floor (300 sats. Signet/testnet fees are
//      tiny). New BTC intents return the remainder as change.
//   3. Build proposal params, propose+auto-approve, execute with
//      `broadcast=true`. Backend forwards to mempool.space's Esplora
//      `POST /tx`.
//
// Network: signet by default, matching the CLI's default and the
// `crates/clear-msig-execution/src/chains/bitcoin.rs` test path. The wallet's chain binding
// returns either testnet or mainnet addresses; we read the binding
// at runtime to decide which network the dWallet is bound to. (For
// pre-alpha all wallets come up on signet/testnet. `tb` HRP. So
// `validateBtcDestination` accepts both.)

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType, ProposalStatus, toHex } from "@/lib/msig";
import {
  assertPreparedBitcoinSetupIsCurrent,
  bytesToHex,
} from "@/features/send/domain/bitcoin";
import {
  hasBitcoinChangeIntent,
  waitForBitcoinChangeIntent,
} from "@/features/send/infrastructure/bitcoinIntent";
import {
  type BtcSetupPendingReason,
} from "@/features/send/ui/bitcoin/BtcSetupStates";
import { shortBtcAddress } from "@/features/send/ui/bitcoin/bitcoinPreview";
import { BtcSendScreen } from "@/features/send/ui/bitcoin/BtcSendScreen";
import { encodeParams } from "@/lib/msig/encode";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import {
  waitForProposalApproval,
  waitForProposalStatus,
} from "@/lib/chain/proposals";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/api/errors";
import { formatUnixSigningExpiry } from "@/lib/api/expiry";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { appConfig } from "@/lib/config";
import { liveUsdEstimate } from "@/lib/clearsign/fiatEstimate";
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
} from "@/lib/clearsign";
import {
  BTC_SEND_FEE_RESERVE_SATS,
  DEFAULT_BITCOIN_NETWORK,
  decodeSegwitAddress,
  bitcoinBroadcastUrl,
  fetchBitcoinAddressSnapshot,
  formatSats,
  mempoolSpaceTxUrl,
  parseBtcAmount,
  reverseHex,
  selectBitcoinSendUtxo,
  validateBtcDestination,
  type BitcoinNetwork,
} from "@/lib/chain/btc";
import {
  BTC_CHAIN_KIND,
  bitcoinSendReady,
  selectBitcoinSendIntent,
} from "@/lib/chain/btcIntentReadiness";

const BTC_TEMPLATE = "examples/intents/btc_transfer.json";
interface BroadcastResultLike {
  chain_kind?: number;
  tx_id?: string;
  raw_tx_hex?: string;
}

export default function BitcoinSendPageWrapper() {
  return (
    <div className="relative flex min-h-screen flex-col bg-canvas">
      <BitcoinSendPage />
    </div>
  );
}

function BitcoinSendPage() {
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

  // ── Wallet + chain binding + intents ──────────────────────────────
  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });
  const chainsQuery = useWalletChains(name);
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
  });

  const btcBinding = useMemo(() => {
    return (chainsQuery.data?.chains ?? []).find(
      (b) => b.chain_kind === BTC_CHAIN_KIND,
    );
  }, [chainsQuery.data]);

  const dwalletAddress = useMemo(() => {
    return btcBinding ? chainAddress(btcBinding) : null;
  }, [btcBinding]);

  const btcSnapshotQuery = useQuery({
    queryKey: ["btc-address-snapshot", dwalletAddress ?? "none"],
    queryFn: () =>
      dwalletAddress
        ? fetchBitcoinAddressSnapshot(dwalletAddress)
        : {
            network: DEFAULT_BITCOIN_NETWORK,
            balanceSats: 0n,
            utxos: [],
          },
    enabled: !!dwalletAddress,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    retry: 2,
    placeholderData: (previous) => previous,
  });
  const btcNetwork: BitcoinNetwork =
    btcSnapshotQuery.data?.network ?? DEFAULT_BITCOIN_NETWORK;

  // sender_pkh: HASH160(dwallet pubkey) = the witness program of the
  // dWallet's own P2WPKH address. We extract by decoding the address
  // we already have from the binding rather than re-deriving from
  // the raw pubkey. The backend already did that math on bind.
  const senderPkhHex = useMemo<string | null>(() => {
    if (!dwalletAddress) return null;
    const decoded = decodeSegwitAddress(dwalletAddress);
    if (!decoded || decoded.version !== 0 || decoded.program.length !== 20) {
      return null;
    }
    return bytesToHex(decoded.program);
  }, [dwalletAddress]);

  const btcIntent = useMemo(() => {
    return selectBitcoinSendIntent((intentsQuery.data ?? []).map((it) => it.account));
  }, [intentsQuery.data]);
  const btcIntentSupportsChange = bitcoinSendReady(btcIntent);

  // ── Live balance + UTXOs ──────────────────────────────────────────
  const balanceSats = btcSnapshotQuery.data?.balanceSats ?? null;
  const btcUtxos = useMemo(
    () => btcSnapshotQuery.data?.utxos ?? [],
    [btcSnapshotQuery.data?.utxos],
  );
  const largestSpendableSats = useMemo(() => {
    const largest = btcUtxos[0];
    if (!largest || largest.value <= Number(BTC_SEND_FEE_RESERVE_SATS)) return 0n;
    return BigInt(largest.value) - BTC_SEND_FEE_RESERVE_SATS;
  }, [btcUtxos]);

  // ── Form state ────────────────────────────────────────────────────
  const [destination, setDestination] = useState("");
  const [amountBtc, setAmountBtc] = useState("");
  const [note, setNote] = useState(() => searchParams?.get("note")?.trim() ?? "");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [sentLabel, setSentLabel] = useState<{
    amountBtc: string;
    to: string;
    note: string;
    txid: string | null;
    explorerUrl: string | null;
  } | null>(null);
  const [awaitingApprovalLabel, setAwaitingApprovalLabel] = useState<{
    amountBtc: string;
    to: string;
    proposal: string;
  } | null>(null);
  // Inline error banner state. The toast version was too easy to miss
  // (auto-dismisses, no copy of the underlying CLI stderr). This lets
  // users actually see the real error and take action without
  // re-clicking Send.
  const [sendError, setSendError] = useState<{
    title: string;
    body: string;
    /// Raw CLI stderr from the BackendApiError payload, if present.
    /// Surfaced behind a "Show technical details" expander.
    stderr?: string;
    /// The proposal address from the failed attempt, if we got that
    /// far. Helps with on-chain forensics.
    proposalAddress?: string;
  } | null>(null);
  const [autoStartedSetup, setAutoStartedSetup] = useState(false);
  const [btcSetupPendingApproval, setBtcSetupPendingApproval] = useState<{
    proposal: string | null;
    reason: BtcSetupPendingReason;
  } | null>(null);
  const autoStartSetup = searchParams?.get("autostart") === "1";

  const sendAmountSats = useMemo<bigint | null>(
    () => parseBtcAmount(amountBtc),
    [amountBtc],
  );

  const sendSelection = useMemo(() => {
    if (!sendAmountSats) return null;
    return selectBitcoinSendUtxo(btcUtxos, sendAmountSats);
  }, [btcUtxos, sendAmountSats]);
  const selectedUtxo = sendSelection?.utxo ?? null;
  const effectiveFeeSats = sendSelection?.feeSats ?? null;
  const changeSats = sendSelection?.changeSats ?? null;

  // ── Mutations: setup intent (one-time), then send ─────────────────
  const setupIntent = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!btcBinding) throw new Error("Bind Bitcoin to this wallet first");
      if (!walletQuery.data) throw new Error("Wallet is still loading");
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
      const me = signerPk.toBase58();
      const proposers = addIntent?.account?.proposers.length
        ? addIntent.account.proposers
        : [me];
      const approvers = addIntent?.account?.approvers.length
        ? addIntent.account.approvers
        : [me];
      const threshold =
        addIntent?.account?.approvalThreshold &&
        addIntent.account.approvalThreshold <= approvers.length
          ? addIntent.account.approvalThreshold
          : 1;
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([threshold]), fheType: "euint8" },
        { plaintext: new Uint8Array([0]), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");
      const dry = await backendApi.prepare.addIntent(name, {
        file: BTC_TEMPLATE,
        proposers,
        approvers,
        threshold,
        cancellation_threshold: 1,
        timelock: 0,
        policy_ciphertexts,
      });
      assertPreparedBitcoinSetupIsCurrent(dry.params_data_hex);
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      const submitted = await backendApi.submit.addIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        file: BTC_TEMPLATE,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a proposal address");
      }
      const decision = await approveIfNeeded(connection, proposal, {
        approvers: addIntent?.account?.approvers,
        approverPubkey: addIntent?.account
          ? wallet.pickSigner(addIntent.account.approvers)?.toBase58() ?? null
          : signerPk.toBase58(),
        approvalThreshold: addIntent?.account?.approvalThreshold ?? 1,
      });
      if (decision.needsApproveSignature) {
        const approverPk = addIntent?.account
          ? wallet.pickSigner(addIntent.account.approvers)
          : signerPk;
        if (!approverPk) {
          throw new Error(
            "The setup proposal landed, but none of your connected wallets can approve it.",
          );
        }
        const approveDry = await backendApi.prepare.approveProposal(
          name,
          proposal,
          { actor_pubkey: approverPk.toBase58() },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      const status = await waitForProposalStatus(connection, proposal, {
        attempts: 12,
        delayMs: 500,
        accepted: [ProposalStatus.Approved, ProposalStatus.Executed],
      });
      if (status === ProposalStatus.Approved) {
        await backendApi.executeProposal(name, proposal, {});
      }
      if (status !== ProposalStatus.Approved && status !== ProposalStatus.Executed) {
        return { proposal, status: "pending_approval" as const };
      }
      const ready = await waitForBitcoinChangeIntent(connection, name);
      if (!ready) {
        return { proposal, status: "pending_sync" as const };
      }
      return { proposal, status: "ready" as const };
    },
    onSuccess: async (result) => {
      // BTC's setup+send live in the same page, so the next render
      // after this mutation flips us from "needs setup" to "compose".
      // `invalidateQueries` alone marks queries stale but returns
      // synchronously. The page would re-render with the still-stale
      // intents list, briefly show "needs setup" again, and the user
      // would tap "Enable" a second time before the background
      // refetch lands. AWAITING the refetch holds us on the success
      // path until the new BTC intent is actually observable.
      await Promise.all([
        queryClient.refetchQueries({ queryKey: ["wallet-intents"] }),
        queryClient.refetchQueries({ queryKey: ["wallet", name] }),
      ]);
      if (result?.status === "pending_approval" || result?.status === "pending_sync") {
        const reason =
          result.status === "pending_approval" ? "approval" : "sync";
        setBtcSetupPendingApproval({
          proposal: result.proposal ?? null,
          reason,
        });
        toast.success("Bitcoin is turning on", {
          details:
            reason === "approval"
              ? "One more approval is needed before BTC sending is ready."
              : "Almost done. ClearSig will keep checking; you do not need to turn it on again.",
        });
        return;
      }
      setBtcSetupPendingApproval(null);
      toast.success("Bitcoin sending ready", {
        details: "BTC sends now return change to the wallet.",
      });
    },
    onError: (err) => {
      console.error("[setup-btc]", err);
      const fe = friendlyError(err, "set-up-spending");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!btcIntent) throw new Error("Bitcoin sends not yet enabled");
      if (!selectedUtxo) throw new Error("No suitable UTXO available");
      if (!sendAmountSats) throw new Error("Enter an amount");
      if (!senderPkhHex) throw new Error("Couldn't derive sender pkh");
      const proposerPk = wallet.pickSigner(btcIntent.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list.",
        );
      }
      const dest = validateBtcDestination(destination, btcNetwork);
      if (!dest.ok) throw new Error(dest.reason);
      const committedRecipient = pkhClearSignRecipient("btc-p2wpkh", dest.pkh);
      const submitPolicyPlan = await resolvePolicyEnforcement(name, {
        walletName: name,
        chainKind: BTC_CHAIN_KIND,
        recipient: destination.trim(),
        ticker: "BTC",
        amountDisplay: amountBtc,
      });
      assertPolicyNotDenied(submitPolicyPlan);
      const walletPda = walletQuery.data?.pda;
      if (!walletPda) throw new Error("Wallet is still loading. Try again.");
      const onchainPolicy = await resolvePersistentSendPolicy(
        connection,
        walletPda,
        name,
        BTC_CHAIN_KIND,
      );

      // Bitcoin txids round-trip in TWO byte orders:
      //   - Esplora / block explorers / `mempool.space` return them in
      //     DISPLAY order (the human-readable BE hex you'd paste into
      //     a search box).
      //   - Bitcoin's internal wire format (BIP143 prev_outpoint, OP_…
      //     anything that goes into a sighash) uses INTERNAL order
      //     (LE. Display-reversed).
      // The on-chain BIP143 builder
      // (`programs/clear-wallet/src/chains/bitcoin.rs:44`) is explicit
      // about wanting internal byte order. We reverse the Esplora hex
      // before stuffing it into the bytes32 param so the sighash
      // computed on chain references the same UTXO Bitcoin's
      // mempool will look up at broadcast time.
      const prevTxidInternal = reverseHex(selectedUtxo.txid);

      const paramsDataHex = toHex(
        encodeParams(btcIntent, {
          prev_txid: `0x${prevTxidInternal}`,
          prev_vout: String(selectedUtxo.vout),
          prev_amount_sats: String(selectedUtxo.value),
          sender_pkh: `0x${senderPkhHex}`,
          recipient_pkh: `0x${bytesToHex(dest.pkh)}`,
          send_amount_sats: sendAmountSats.toString(),
          change_pkh: `0x${senderPkhHex}`,
          fee_sats: BTC_SEND_FEE_RESERVE_SATS.toString(),
        }),
      );

      const actionId = randomActionLabel("btc-send");
      const actionNonce = randomActionLabel("nonce");
      const expiresAt = Math.floor(Date.now() / 1000) + 15 * 60;
      const policyCommitment =
        onchainPolicy?.commitmentHex ??
        policyCommitmentHexForParts([
          `wallet:${walletQuery.data?.pda.toBase58() ?? name}`,
          `intent:${btcIntent.intentIndex}`,
          `chain:${BTC_CHAIN_KIND}`,
          `threshold:${btcIntent.approvalThreshold ?? ""}`,
          `proposers:${btcIntent.proposers.join(",")}`,
          `approvers:${btcIntent.approvers.join(",")}`,
        ]);
      const envelope: ClearSignEnvelope<SendPayload> = {
        version: 3,
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
          amount: amountBtc.trim(),
          asset: "BTC",
          assetEncoding: "sha256_text",
          note: note.trim() || undefined,
          estimatedUsd: liveUsdEstimate(amountBtc, "BTC"),
        },
      };
      const summary = await prepareClearSignAction(envelope, {
        fallback: false,
      });
      const dry = await backendApi.prepare.createTypedProposal(name, {
        intent_index: btcIntent.intentIndex,
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
        approvers: btcIntent.approvers,
        approverPubkey: wallet.pickSigner(btcIntent.approvers)?.toBase58() ?? null,
        approvalThreshold: btcIntent.approvalThreshold,
      });
      if (decision.needsApproveSignature) {
        const approverPk = wallet.pickSigner(btcIntent.approvers);
        if (!approverPk) {
          throw new Error(
            "The proposal landed, but none of your connected wallets can approve it.",
          );
        }
        const approveDry = await backendApi.prepare.approveTypedProposal(
          name,
          proposal,
          { actor_pubkey: approverPk.toBase58() },
        );
        const approveSigned = await signTypedDescriptor(approveDry, {
          preferSigner: approverPk,
        });
        await backendApi.submit.approveTypedProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      assertPolicyNotDenied(submitPolicyPlan);
      if (submitPolicyPlan.evaluation?.matched) {
        if (submitPolicyPlan.rule?.action === "require-extra-approvers") {
          const seen = new Set<string>([
            proposerPk.toBase58(),
            wallet.pickSigner(btcIntent.approvers)?.toBase58() ?? "",
          ]);
          const extraApprovers = submitPolicyPlan.extraApprovers.filter((addr) => {
            const normalized = addr.trim();
            if (!normalized || seen.has(normalized)) return false;
            seen.add(normalized);
            return true;
          });
          if (extraApprovers.length === 0) {
            throw new Error(
              `Policy "${submitPolicyPlan.rule.name}" requires extra approvers, but none were configured.`,
            );
          }
          for (const extraApprover of extraApprovers) {
            if (!btcIntent.approvers.includes(extraApprover)) {
              throw new Error(
                `Policy "${submitPolicyPlan.rule.name}" requires ${extraApprover} to approve this send, but that signer is not in the wallet's approver list.`,
              );
            }
            const extraSigner = wallet.pickSigner([extraApprover]);
            if (!extraSigner) {
              throw new Error(
                `Policy "${submitPolicyPlan.rule.name}" requires ${extraApprover} to approve this send, but none of your connected wallets can sign as that approver.`,
              );
            }
            const extraDry = await backendApi.prepare.approveTypedProposal(
              name,
              proposal,
              { actor_pubkey: extraSigner.toBase58() },
            );
            const extraSigned = await signTypedDescriptor(extraDry, {
              preferSigner: extraSigner,
            });
            await backendApi.submit.approveTypedProposal(name, proposal, {
              ...extraSigned,
              expiry: extraDry.expiry,
            });
          }
        } else if (
          submitPolicyPlan.rule?.action === "require-cooldown" &&
          submitPolicyPlan.extraCooldownSeconds > 0
        ) {
          await new Promise((resolve) =>
            setTimeout(resolve, submitPolicyPlan.extraCooldownSeconds * 1000),
          );
        }
      }
      const readyToExecute = await waitForProposalApproval(connection, proposal);
      if (!readyToExecute) {
        return { proposal, broadcast: null, awaitingApprovers: true };
      }
      const executed = await backendApi.executeTypedChainSend(name, proposal, {
        chainKind: BTC_CHAIN_KIND,
        amountRaw: sendAmountSats.toString(),
        recipientHash: textCommitmentHex(committedRecipient),
        assetIdHash: textCommitmentHex("BTC"),
        paramsDataHex,
        broadcast: true,
        dwalletProgram: appConfig.preAlpha.dwalletProgramId,
        grpcUrl: appConfig.preAlpha.grpcUrl,
        // BTC needs a Bitcoin RPC/Esplora base, not the backend's
        // EVM destination RPC. We pass the network-specific Bitcoin
        // endpoint explicitly so the CLI's Bitcoin broadcast adapter
        // can choose Alchemy JSON-RPC or Esplora as appropriate.
        rpcUrl: bitcoinBroadcastUrl(btcNetwork),
      });
      const broadcast = (executed as { broadcast?: BroadcastResultLike })
        ?.broadcast;
      return { proposal, broadcast, awaitingApprovers: false };
    },
    onSuccess: ({ proposal, broadcast, awaitingApprovers }) => {
      if (awaitingApprovers) {
        setAwaitingApprovalLabel({
          amountBtc: amountBtc.trim(),
          to: shortBtcAddress(destination.trim()),
          proposal,
        });
        toast.success("Bitcoin request created", {
          details: "It is waiting for the remaining approval before broadcast.",
        });
        return;
      }
      const txid = broadcast?.tx_id ?? null;
      const explorerUrl = txid ? mempoolSpaceTxUrl(txid, btcNetwork) : null;
      setSentLabel({
        amountBtc: amountBtc.trim(),
        to: shortBtcAddress(destination.trim()),
        note: note.trim(),
        txid,
        explorerUrl,
      });
      // Refresh balance + UTXOs so the next send sees the spent state.
      void queryClient.invalidateQueries({
        queryKey: ["btc-address-snapshot", dwalletAddress ?? "none"],
      });
    },
    onError: (err, _vars, _ctx) => {
      console.error("[send-btc]", err);
      const fe = friendlyError(err, "send");
      // Toast still fires (matches the rest of the app's send flows),
      // but the inline banner is the durable surface for the stderr ,
      // a 5-second toast wasn't enough to read or copy the underlying
      // CLI message before it disappeared. Pull stderr off
      // BackendApiError directly.
      const stderr =
        err instanceof BackendApiError
          ? (err.payload?.stderr ?? undefined)
          : undefined;
      setSendError({
        title: fe.title,
        body: fe.body ?? "",
        stderr,
      });
      toast.error(fe.title, { details: fe.body });
    },
  });

  const handleSend = () => {
    // Clear any prior error banner. A fresh attempt deserves a clean
    // canvas; leftover stderr from a previous failure would confuse
    // the picture if THIS one succeeds.
    setSendError(null);
    setDestinationError(null);
    setAmountError(null);
    if (!destination.trim()) {
      setDestinationError("Enter a Bitcoin address.");
      return;
    }
    const dest = validateBtcDestination(destination, btcNetwork);
    if (!dest.ok) {
      setDestinationError(dest.reason);
      return;
    }
    if (!sendAmountSats) {
      setAmountError("Enter an amount in BTC (e.g. 0.001).");
      return;
    }
    if (!selectedUtxo) {
      const max = btcUtxos[0]?.value ?? 0;
      setAmountError(
        `This amount is too high right now. Tap Use max or enter less than ${formatSats(BigInt(max))} BTC.`,
      );
      return;
    }
    send.mutate();
  };

  // ── Render ────────────────────────────────────────────────────────
  const walletDisplay = toDisplayName(name);

  const isLoading =
    walletQuery.isLoading || chainsQuery.isLoading || intentsQuery.isLoading;
  const blockedByDisconnect = !wallet.connected;
  const blockedByLedger = wallet.isLedger;
  const needsBinding =
    !blockedByDisconnect && !blockedByLedger && !isLoading && !btcBinding;
  const needsSetup =
    !blockedByDisconnect &&
    !blockedByLedger &&
    !isLoading &&
    btcBinding &&
    !btcIntentSupportsChange;
  const ready =
    !blockedByDisconnect &&
    !blockedByLedger &&
    !isLoading &&
    btcBinding &&
    btcIntentSupportsChange;
  const policyEvaluation = usePolicyEvaluation({
    walletName: name,
    chainKind: BTC_CHAIN_KIND,
    recipient: destination.trim(),
    ticker: "BTC",
    amountDisplay: amountBtc,
    enabled:
      !!destination.trim() &&
      !!sendAmountSats &&
      !!btcBinding &&
      btcIntentSupportsChange,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";
  const canSubmit =
    !!btcBinding &&
    !!btcIntent &&
    btcIntentSupportsChange &&
    !blockedByDisconnect &&
    !blockedByLedger &&
    !isLoading &&
    !!sendAmountSats &&
    !!selectedUtxo &&
    !!senderPkhHex &&
    !policyDenied;

  useEffect(() => {
    if (btcIntentSupportsChange) setBtcSetupPendingApproval(null);
  }, [btcIntentSupportsChange]);

  useEffect(() => {
    if (!btcSetupPendingApproval || btcSetupPendingApproval.reason !== "sync") {
      return;
    }
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      inFlight = true;
      await Promise.allSettled([
        queryClient.refetchQueries({ queryKey: ["wallet-intents"] }),
        queryClient.refetchQueries({ queryKey: ["wallet", name] }),
      ]);
      const readyNow = await hasBitcoinChangeIntent(connection, name);
      inFlight = false;
      if (!cancelled && readyNow) {
        setBtcSetupPendingApproval(null);
      }
    };
    void tick();
    const id = window.setInterval(() => {
      void tick();
    }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [btcSetupPendingApproval, connection, name, queryClient]);

  useEffect(() => {
    if (!autoStartSetup || autoStartedSetup || !needsSetup) return;
    if (setupIntent.isPending || setupIntent.isSuccess) return;
    setAutoStartedSetup(true);
    setupIntent.mutate();
  }, [autoStartSetup, autoStartedSetup, needsSetup, setupIntent]);

  return (
    <BtcSendScreen
      walletName={name}
      walletDisplay={walletDisplay}
      network={btcNetwork}
      reduceMotion={!!reduce}
      disconnected={blockedByDisconnect}
      ledgerBlocked={blockedByLedger}
      loading={isLoading}
      needsBinding={!!needsBinding}
      needsSetup={!!needsSetup}
      ready={!!ready}
      setupPending={setupIntent.isPending}
      setupSucceeded={setupIntent.isSuccess}
      onSetup={() => setupIntent.mutate()}
      setupRequest={
        btcSetupPendingApproval
          ? {
              walletName: name,
              proposal: btcSetupPendingApproval.proposal,
              reason: btcSetupPendingApproval.reason,
            }
          : null
      }
      bindingAddress={dwalletAddress}
      balanceSats={balanceSats}
      balanceLoading={btcSnapshotQuery.isLoading}
      balanceError={btcSnapshotQuery.error}
      sendError={sendError}
      onResetError={() => {
        setSendError(null);
        setDestination("");
        setAmountBtc("");
        setDestinationError(null);
        setAmountError(null);
      }}
      onDismissError={() => setSendError(null)}
      policyEvaluation={policyEvaluation}
      compose={{
        destination,
        setDestination,
        destinationError,
        amountBtc,
        setAmountBtc,
        note,
        setNote,
        amountError,
        balanceSats,
        balanceLoading: btcSnapshotQuery.isLoading,
        balanceError: btcSnapshotQuery.error,
        maxSpendableSats: largestSpendableSats,
        selectedUtxo,
        effectiveFeeSats,
        changeSats,
        address: dwalletAddress,
        network: btcNetwork,
        sending: send.isPending,
        canSubmit,
        walletDisplay,
        onSend: handleSend,
      }}
      approvalThreshold={btcIntent?.approvalThreshold ?? 1}
      timelockSeconds={btcIntent?.timelockSeconds ?? 0}
      sent={sentLabel}
      awaitingApproval={awaitingApprovalLabel}
      onSendAnother={() => {
        setSentLabel(null);
        setDestination("");
        setAmountBtc("");
        setNote("");
      }}
      onRequestAnother={() => {
        setAwaitingApprovalLabel(null);
        setDestination("");
        setAmountBtc("");
        setNote("");
      }}
    />
  );
}
