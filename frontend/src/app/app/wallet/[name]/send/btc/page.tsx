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
//   2. BTC `Custom` intent exists on the wallet? If no → register one
//      via the standard add-intent meta proposal flow + auto-execute.
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
// `cli/src/chains/bitcoin.rs` test path. The wallet's chain binding
// returns either testnet or mainnet addresses; we read the binding
// at runtime to decide which network the dWallet is bound to. (For
// pre-alpha all wallets come up on signet/testnet. `tb` HRP. So
// `validateBtcDestination` accepts both.)

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Loader2, Send, X } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { fetchIntent, listIntents } from "@/lib/chain/intents";
import { IntentType, ProposalStatus } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { fetchProposal } from "@/lib/chain/proposals";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { usePolicyEvaluation } from "@/lib/hooks/usePolicyEvaluation";
import { PolicyMatchBanner } from "@/components/security/PolicyMatchBanner";
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
import { InfoTip } from "@/components/retail/InfoTip";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { chainByKind } from "@/lib/retail/chains";
import { appConfig } from "@/lib/config";
import {
  SEND_NOTE_LABEL,
  SEND_NOTE_MAX_LENGTH,
  SEND_NOTE_PLACEHOLDER,
} from "@/lib/sendFields";
import { resolvePolicyEnforcement } from "@/lib/policies/enforce";
import {
  DEFAULT_BITCOIN_NETWORK,
  decodeSegwitAddress,
  esploraBaseUrl,
  bitcoinExplorerLabel,
  fetchBitcoinAddressSnapshot,
  formatSats,
  mempoolSpaceTxUrl,
  parseBtcAmount,
  reverseHex,
  validateBtcDestination,
  type BitcoinNetwork,
  type EsploraUtxo,
} from "@/lib/chain/btc";

const BTC_TEMPLATE = "examples/intents/btc_transfer.json";
const BTC_CHAIN_KIND = 2;
/// Conservative fee floor. Signet/testnet routinely accept ≤200 sats
/// but we leave headroom so a stale Esplora UTXO snapshot doesn't
/// trigger a "min relay fee not met" rejection on broadcast.
const FEE_RESERVE_SATS = 300n;
const MAX_SAFE_IMPLIED_FEE_SATS = 1000n;

interface BroadcastResultLike {
  chain_kind?: number;
  tx_id?: string;
  raw_tx_hex?: string;
}

type BtcIntentAccount = NonNullable<
  Awaited<ReturnType<typeof listIntents>>[number]["account"]
>;

export default function BitcoinSendPageWrapper() {
  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <BitcoinSendPage />
    </main>
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
  const { signDescriptor } = useSignWithWallet();
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
    let best: BtcIntentAccount | null = null;
    for (const intent of intentsQuery.data ?? []) {
      const account = intent.account;
      if (
        !account ||
        account.intentType !== IntentType.Custom ||
        account.chainKind !== BTC_CHAIN_KIND
      ) {
        continue;
      }
      if (!best || account.params.length > best.params.length) best = account;
    }
    return best;
  }, [intentsQuery.data]);
  const btcIntentSupportsChange = (btcIntent?.params.length ?? 0) >= 8;

  // ── Live balance + UTXOs ──────────────────────────────────────────
  const balanceSats = btcSnapshotQuery.data?.balanceSats ?? null;
  const btcUtxos = useMemo(
    () => btcSnapshotQuery.data?.utxos ?? [],
    [btcSnapshotQuery.data?.utxos],
  );
  const largestSpendableSats = useMemo(() => {
    const largest = btcUtxos[0];
    if (!largest || largest.value <= Number(FEE_RESERVE_SATS)) return 0n;
    return BigInt(largest.value) - FEE_RESERVE_SATS;
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
  const [sendAfterUpgrade, setSendAfterUpgrade] = useState(false);
  const [btcSetupPendingApproval, setBtcSetupPendingApproval] = useState<{
    proposal: string | null;
  } | null>(null);
  const autoStartSetup = searchParams?.get("autostart") === "1";

  const sendAmountSats = useMemo<bigint | null>(
    () => parseBtcAmount(amountBtc),
    [amountBtc],
  );

  // Single UTXO that's ≥ requested amount + fee reserve. The BTC template now
  // returns change; multi-input still needs a future template extension.
  const selectedUtxo = useMemo<EsploraUtxo | null>(() => {
    if (!btcUtxos.length || !sendAmountSats) return null;
    const need = sendAmountSats + FEE_RESERVE_SATS;
    // UTXOs arrive sorted by value in Esplora. Pick the smallest one
    // that covers `need`; v2 BTC intents return the remainder as change,
    // while older intents still block unsafe implied fees below.
    const candidates = [...btcUtxos].sort((a, b) => a.value - b.value);
    for (const u of candidates) {
      if (BigInt(u.value) >= need) return u;
    }
    return null;
  }, [btcUtxos, sendAmountSats]);

  const impliedFeeSats = useMemo<bigint | null>(() => {
    if (!selectedUtxo || !sendAmountSats) return null;
    return BigInt(selectedUtxo.value) - sendAmountSats;
  }, [selectedUtxo, sendAmountSats]);
  const effectiveFeeSats = useMemo<bigint | null>(() => {
    if (!selectedUtxo || !sendAmountSats) return null;
    return btcIntentSupportsChange ? FEE_RESERVE_SATS : impliedFeeSats;
  }, [btcIntentSupportsChange, impliedFeeSats, selectedUtxo, sendAmountSats]);
  const changeSats = useMemo<bigint | null>(() => {
    if (!btcIntentSupportsChange || !selectedUtxo || !sendAmountSats) return null;
    const change = BigInt(selectedUtxo.value) - sendAmountSats - FEE_RESERVE_SATS;
    return change > 0n ? change : 0n;
  }, [btcIntentSupportsChange, selectedUtxo, sendAmountSats]);

  // ── Mutations: setup intent (one-time), then send ─────────────────
  const setupIntent = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!btcBinding) throw new Error("Bind Bitcoin to this wallet first");
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
      const intent = btcIntent;
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

      const policyPlan = await resolvePolicyEnforcement(name, {
        walletName: name,
        chainKind: BTC_CHAIN_KIND,
        recipient: destination,
        ticker: "BTC",
        amountDisplay: amountBtc,
      });
      if (policyPlan.evaluation?.matched) {
        if (policyPlan.rule?.action === "require-extra-approvers") {
          if (!intent) {
            throw new Error("Bitcoin sending isn't set up for this wallet");
          }
          const seen = new Set<string>([signerPk.toBase58()]);
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
            const extraDry = await backendApi.prepare.approveProposal(
              name,
              proposal,
              { actor_pubkey: extraSigner.toBase58() },
            );
            const extraSigned = await signDescriptor(extraDry, {
              preferSigner: extraSigner,
            });
            await backendApi.submit.approveProposal(name, proposal, {
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
      await backendApi.executeProposal(name, proposal, {});
    },
    onSuccess: async () => {
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
      toast.success(`${toHeadingName(name)} can now send Bitcoin`);
    },
    onError: (err) => {
      console.error("[setup-btc]", err);
      const fe = friendlyError(err, "set-up-spending");
      toast.error(fe.title, { details: fe.body });
    },
  });

  const upgradeBitcoinIntent = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!walletQuery.data) throw new Error("Wallet is still loading");
      const intent = btcIntent;
      if (!intent) throw new Error("Bitcoin sending is not set up yet");
      if (btcIntentSupportsChange) {
        return { upgraded: true, awaitingApprovers: false, proposal: null };
      }
      const updateIntent = (intentsQuery.data ?? []).find(
        (it) => it.account?.intentType === IntentType.UpdateIntent,
      );
      const signerPk = updateIntent?.account
        ? wallet.pickSigner(updateIntent.account.approvers)
        : wallet.pickSigner(intent.approvers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets can approve the Bitcoin setup.",
        );
      }
      const enc = new TextEncoder();
      const encrypted = await encryptPolicyBatch([
        { plaintext: enc.encode(JSON.stringify(intent.proposers)), fheType: "ebytes" },
        { plaintext: enc.encode(JSON.stringify(intent.approvers)), fheType: "ebytes" },
        { plaintext: new Uint8Array([intent.approvalThreshold]), fheType: "euint8" },
        { plaintext: u32LeBytes(intent.timelockSeconds), fheType: "euint32" },
      ]);
      const policy_ciphertexts = encrypted
        .map((p) => p.ciphertextIdentifier)
        .filter((id): id is string => typeof id === "string");

      const dry = await backendApi.prepare.updateIntent(name, {
        index: intent.intentIndex,
        file: BTC_TEMPLATE,
        proposers: intent.proposers,
        approvers: intent.approvers,
        threshold: intent.approvalThreshold,
        cancellation_threshold: intent.cancellationThreshold,
        timelock: intent.timelockSeconds,
        policy_ciphertexts,
      });
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
      const submitted = await backendApi.submit.updateIntent(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        index: intent.intentIndex,
        file: BTC_TEMPLATE,
        policy_ciphertexts,
      });
      const proposal = (submitted as Record<string, unknown>)?.proposal;
      if (typeof proposal !== "string" || proposal.length === 0) {
        throw new Error("Backend didn't return a Bitcoin setup proposal address");
      }

      const decision = await approveIfNeeded(connection, proposal, {
        approvers: updateIntent?.account?.approvers ?? intent.approvers,
        approverPubkey: signerPk.toBase58(),
        approvalThreshold:
          updateIntent?.account?.approvalThreshold ?? intent.approvalThreshold,
      });
      if (decision.needsApproveSignature) {
        const approverPk = updateIntent?.account
          ? wallet.pickSigner(updateIntent.account.approvers)
          : wallet.pickSigner(intent.approvers);
        if (!approverPk) {
          throw new Error(
            "The Bitcoin setup proposal landed, but none of your connected wallets can approve it.",
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
      const statusBeforeExecute = await waitForProposalStatusOneOf(
        connection,
        proposal,
        [ProposalStatus.Approved, ProposalStatus.Executed],
      );
      if (statusBeforeExecute === ProposalStatus.Approved) {
        await backendApi.executeProposal(name, proposal, {});
      }
      if (statusBeforeExecute !== ProposalStatus.Approved && statusBeforeExecute !== ProposalStatus.Executed) {
        return { upgraded: false, awaitingApprovers: true, proposal };
      }

      const upgraded = await waitForIntentParamCount(
        connection,
        walletQuery.data.pda,
        intent.intentIndex,
        8,
      );
      if (!upgraded) {
        throw new Error(
          "The Bitcoin setup transaction was submitted, but the wallet still reports the old Bitcoin intent. Wait a moment and refresh.",
        );
      }
      return { upgraded: true, awaitingApprovers: false, proposal };
    },
    onSuccess: async (result) => {
      await queryClient.refetchQueries({ queryKey: ["wallet-intents"] });
      if (result?.awaitingApprovers) {
        setBtcSetupPendingApproval({ proposal: result.proposal ?? null });
        setSendAfterUpgrade(false);
        toast.success("Bitcoin setup requested", {
          details:
            "It still needs the remaining approval before BTC sends can return change.",
        });
        return;
      }
      setBtcSetupPendingApproval(null);
      toast.success("Bitcoin sending ready", {
        details: "BTC sends now return change to the wallet.",
      });
    },
    onError: (err) => {
      console.error("[upgrade-btc]", err);
      setSendAfterUpgrade(false);
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
      if (
        !btcIntentSupportsChange &&
        impliedFeeSats !== null &&
        impliedFeeSats > MAX_SAFE_IMPLIED_FEE_SATS
      ) {
        throw new Error(
          `This Bitcoin send needs change-output setup before it can continue.`,
        );
      }
      if (!senderPkhHex) throw new Error("Couldn't derive sender pkh");
      const proposerPk = wallet.pickSigner(btcIntent.proposers);
      if (!proposerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's proposer list.",
        );
      }
      const dest = validateBtcDestination(destination, btcNetwork);
      if (!dest.ok) throw new Error(dest.reason);

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

      const proposalParams = [
        `prev_txid=0x${prevTxidInternal}`,
        `prev_vout=${selectedUtxo.vout}`,
        `prev_amount_sats=${selectedUtxo.value}`,
        `sender_pkh=0x${senderPkhHex}`,
        `recipient_pkh=0x${bytesToHex(dest.pkh)}`,
        `send_amount_sats=${sendAmountSats.toString()}`,
      ];
      if (btcIntentSupportsChange) {
        proposalParams.push(
          `change_pkh=0x${senderPkhHex}`,
          `fee_sats=${FEE_RESERVE_SATS.toString()}`,
        );
      }

      const dry = await backendApi.prepare.createProposal(name, {
        intent_index: btcIntent.intentIndex,
        params: proposalParams,
        actor_pubkey: proposerPk.toBase58(),
      });
      const signed = await signDescriptor(dry, { preferSigner: proposerPk });
      const submitted = await backendApi.submit.createProposal(name, {
        ...signed,
        params_data_hex: dry.params_data_hex,
        expiry: dry.expiry,
        intent_index: btcIntent.intentIndex,
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
      const statusBeforeExecute = await waitForProposalStatus(connection, proposal);
      if (statusBeforeExecute !== ProposalStatus.Approved) {
        return { proposal, broadcast: null, awaitingApprovers: true };
      }
      const executed = await backendApi.executeProposal(name, proposal, {
        broadcast: true,
        dwallet_program: appConfig.preAlpha.dwalletProgramId,
        grpc_url: appConfig.preAlpha.grpcUrl,
        // BTC needs a Bitcoin RPC/Esplora base, not the backend's
        // EVM destination RPC. We pass the network-specific Bitcoin
        // endpoint explicitly so the CLI's Bitcoin broadcast adapter
        // can choose Alchemy JSON-RPC or Esplora as appropriate.
        rpc_url: esploraBaseUrl(btcNetwork),
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
        `No single UTXO covers ${formatSats(sendAmountSats)} BTC + fee reserve (${formatSats(FEE_RESERVE_SATS)} BTC). Largest UTXO: ${formatSats(BigInt(max))} BTC.`,
      );
      return;
    }
    if (
      !btcIntentSupportsChange &&
      impliedFeeSats !== null &&
      impliedFeeSats > MAX_SAFE_IMPLIED_FEE_SATS
    ) {
      const safeAmount = BigInt(selectedUtxo.value) - FEE_RESERVE_SATS;
      setAmountError(
        `Use max for this UTXO (${formatSats(safeAmount)} BTC). Partial BTC sends need change setup first.`,
      );
      return;
    }
    send.mutate();
  };

  // ── Render ────────────────────────────────────────────────────────
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const btcMeta = chainByKind(BTC_CHAIN_KIND);
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
    enabled: !!destination.trim() && !!sendAmountSats && !!btcBinding && !!btcIntent,
  });
  const policyDenied =
    policyEvaluation?.matched && policyEvaluation.action === "deny";
  const canSubmit =
    !!btcBinding &&
    !!btcIntent &&
    !blockedByDisconnect &&
    !blockedByLedger &&
    !isLoading &&
    !!sendAmountSats &&
    !!selectedUtxo &&
    !!senderPkhHex &&
    !policyDenied;

  useEffect(() => {
    if (!sendAfterUpgrade) return;
    if (upgradeBitcoinIntent.isPending) return;
    if (!btcIntentSupportsChange) return;
    setSendAfterUpgrade(false);
    setBtcSetupPendingApproval(null);
    send.mutate();
  }, [btcIntentSupportsChange, sendAfterUpgrade, send, upgradeBitcoinIntent.isPending]);

  useEffect(() => {
    if (btcIntentSupportsChange) setBtcSetupPendingApproval(null);
  }, [btcIntentSupportsChange]);

  useEffect(() => {
    if (!autoStartSetup || autoStartedSetup || !needsSetup) return;
    if (setupIntent.isPending || setupIntent.isSuccess) return;
    setAutoStartedSetup(true);
    setupIntent.mutate();
  }, [autoStartSetup, autoStartedSetup, needsSetup, setupIntent]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col lg:max-w-3xl">
      <motion.section
        {...motionProps}
        transition={{ duration: 0.3 }}
        className="flex w-full flex-col gap-5"
      >
        {/* Compact left-aligned header. Matches SOL + ETH /send. */}
        <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex items-center gap-3">
            {btcMeta ? <ChainBadge chain={btcMeta} size="md" /> : null}
            <div className="flex flex-col gap-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Send
              </p>
              <h1 className="hidden md:block font-display text-2xl font-semibold leading-tight text-text-strong sm:text-3xl">
                Send BTC
              </h1>
            </div>
          </div>
          <p className="text-xs text-text-soft sm:text-sm">
            From{" "}
            <span className="font-medium text-text-strong">
              {walletDisplay}
            </span>
            <span className="ml-1 text-text-soft/70">· {btcNetwork}</span>
          </p>
        </header>

        <SendChainPicker walletName={name} activeKind={BTC_CHAIN_KIND} />

        {blockedByDisconnect && (
          <BlockedNote
            title="Sign in first"
            body="Connect your Solana wallet to authorise sends from this multisig."
          />
        )}
        {!blockedByDisconnect && blockedByLedger && (
          <BlockedNote
            title="Ledger not supported here"
            body="The Bitcoin send flow needs the Dynamic embedded signer. Switch wallets and retry."
          />
        )}
        {isLoading && !blockedByDisconnect && !blockedByLedger && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-text-soft">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Reading wallet state…
          </div>
        )}

        {needsBinding && (
          <NeedsBinding walletName={name} reduce={!!reduce} />
        )}
        {needsSetup && (
          <NeedsSetup
            walletDisplay={walletDisplay}
            address={dwalletAddress}
            balanceSats={balanceSats}
            balanceLoading={btcSnapshotQuery.isLoading}
            balanceError={btcSnapshotQuery.error}
            network={btcNetwork}
            onSetup={() => setupIntent.mutate()}
            busy={setupIntent.isPending}
            reduce={!!reduce}
          />
        )}
        {ready && !sentLabel && !awaitingApprovalLabel && sendError && (
          <SendErrorBanner
            error={sendError}
            onReset={() => {
              setSendError(null);
              setDestination("");
              setAmountBtc("");
              setDestinationError(null);
              setAmountError(null);
            }}
            onDismiss={() => setSendError(null)}
          />
        )}
        {ready &&
          !sentLabel &&
          !awaitingApprovalLabel &&
          !sendError &&
          btcSetupPendingApproval && (
            <BitcoinSetupPendingCard
              walletName={name}
              proposal={btcSetupPendingApproval.proposal}
            />
          )}
        {ready && !sentLabel && !awaitingApprovalLabel && policyEvaluation?.matched && (
          <PolicyMatchBanner walletName={name} evaluation={policyEvaluation} />
        )}
        {ready && !sentLabel && !awaitingApprovalLabel && (
          <div className="flex flex-col gap-3">
            <SignPayloadPreview
              action={
                sendAmountSats && destination.trim()
                  ? `Send ${amountBtc.trim()} BTC to ${shortBtcAddress(destination.trim())}`
                  : "Fill in the amount and recipient above"
              }
              details={buildBtcPreviewDetails({
                walletDisplay,
                destination,
                amountBtc,
                selectedUtxo,
                impliedFeeSats,
                effectiveFeeSats,
                changeSats,
                supportsChange: btcIntentSupportsChange,
                note,
              })}
              warning={buildBtcWarning({
                selectedUtxo,
                impliedFeeSats,
                supportsChange: btcIntentSupportsChange,
              })}
              collapsibleDetails
            />
          </div>
        )}
        {ready && !sentLabel && !awaitingApprovalLabel && (
          <ComposeForm
            destination={destination}
            setDestination={setDestination}
            destinationError={destinationError}
            amountBtc={amountBtc}
            setAmountBtc={setAmountBtc}
            note={note}
            setNote={setNote}
            amountError={amountError}
            balanceSats={balanceSats}
            balanceLoading={btcSnapshotQuery.isLoading}
            balanceError={btcSnapshotQuery.error}
            maxSpendableSats={largestSpendableSats}
            selectedUtxo={selectedUtxo}
            impliedFeeSats={impliedFeeSats}
            effectiveFeeSats={effectiveFeeSats}
            changeSats={changeSats}
            supportsChange={btcIntentSupportsChange}
            address={dwalletAddress}
            network={btcNetwork}
            sending={send.isPending}
            canSubmit={canSubmit}
            autoUpgrading={sendAfterUpgrade || upgradeBitcoinIntent.isPending}
            walletDisplay={walletDisplay}
            onSend={handleSend}
          />
        )}
        {sentLabel && (
          <SentCard
            sent={sentLabel}
            walletDisplay={walletDisplay}
            walletName={name}
            network={btcNetwork}
            onAnother={() => {
              setSentLabel(null);
              setDestination("");
              setAmountBtc("");
              setNote("");
            }}
          />
        )}
        {awaitingApprovalLabel && (
          <AwaitingApprovalCard
            request={awaitingApprovalLabel}
            walletDisplay={walletDisplay}
            walletName={name}
            onAnother={() => {
              setAwaitingApprovalLabel(null);
              setDestination("");
              setAmountBtc("");
              setNote("");
            }}
          />
        )}
      </motion.section>
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function BlockedNote({ title, body }: { title: string; body: string }) {
  return (
    <aside className="rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
      <p className="font-medium text-text-strong">{title}</p>
      <p className="mt-1">{body}</p>
    </aside>
  );
}

function NeedsBinding({
  walletName,
  reduce,
}: {
  walletName: string;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=bitcoin_p2wpkh&autostart=1`}
        className="self-start"
      >
        <Button>
          Turn on Bitcoin
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Link>
    </motion.section>
  );
}

function NeedsSetup({
  walletDisplay,
  address,
  balanceSats,
  balanceLoading,
  balanceError,
  network,
  onSetup,
  busy,
  reduce,
}: {
  walletDisplay: string;
  address: string | null;
  balanceSats: bigint | null;
  balanceLoading: boolean;
  balanceError: Error | null;
  network: BitcoinNetwork;
  onSetup: () => void;
  busy: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      {address && (
        <div className="rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Bitcoin address
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
            {address}
          </p>
          <p className="mt-2 font-numerals text-[11px] tabular-nums text-text-soft">
            Balance:{" "}
            {balanceLoading ? (
              "checking..."
            ) : balanceSats !== null ? (
              <>
                {formatSats(balanceSats)} BTC
              <UsdHint
                amount={balanceSats}
                smallestPerWhole={100_000_000n}
                ticker="BTC"
              />
              </>
            ) : (
              btcBalanceStatusLabel(balanceError, network)
            )}
          </p>
        </div>
      )}
      <Button onClick={onSetup} disabled={busy} fullWidth>
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Registering…
          </>
        ) : (
          <>
            Turn on Bitcoin
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </>
        )}
      </Button>
    </motion.section>
  );
}

function ComposeForm(props: {
  destination: string;
  setDestination: (v: string) => void;
  destinationError: string | null;
  amountBtc: string;
  setAmountBtc: (v: string) => void;
  note: string;
  setNote: (v: string) => void;
  amountError: string | null;
  balanceSats: bigint | null;
  balanceLoading: boolean;
  balanceError: Error | null;
  maxSpendableSats: bigint;
  selectedUtxo: EsploraUtxo | null;
  impliedFeeSats: bigint | null;
  effectiveFeeSats: bigint | null;
  changeSats: bigint | null;
  supportsChange: boolean;
  address: string | null;
  network: BitcoinNetwork;
  sending: boolean;
  canSubmit: boolean;
  autoUpgrading: boolean;
  walletDisplay: string;
  onSend: () => void;
}) {
  const balanceBtc =
    props.balanceSats !== null ? formatSats(props.balanceSats) : null;
  return (
    <>
      {/* Compose grid. Amount + Recipient sit side-by-side on lg+
          and merge into one bordered card on mobile. Same shell as
          SOL /send and ETH /send/eth. */}
      <div
        className={
          "flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
          "lg:grid lg:grid-cols-2 lg:items-start lg:gap-4 " +
          "lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none"
        }
      >
        {/* Amount card. Balance + Use max live with the input so the
            spendable BTC state stays visually scoped. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <SendAmountField
            id="btc-amount"
            ticker="BTC"
            value={props.amountBtc}
            onChange={(e) => props.setAmountBtc(e.target.value)}
            maxLength={20}
            action={
              props.maxSpendableSats > 0n ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    props.setAmountBtc(formatSats(props.maxSpendableSats));
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
                  {props.balanceLoading
                    ? "checking..."
                    : balanceBtc !== null
                      ? balanceBtc
                      : btcBalanceStatusLabel(props.balanceError, props.network)}
                </span>
                {balanceBtc !== null ? <span> BTC</span> : null}
                {props.balanceSats !== null && (
                  <UsdHint
                    amount={props.balanceSats}
                    smallestPerWhole={100_000_000n}
                    ticker="BTC"
                  />
                )}
                {props.amountError && (
                  <span className="ml-1.5 text-warning">{props.amountError}</span>
                )}
                {props.selectedUtxo && props.effectiveFeeSats !== null && (
                  <span className="block pt-1 text-[11px]">
                    Using UTXO{" "}
                    <span className="font-mono text-text-strong">
                      {props.selectedUtxo.txid.slice(0, 8)}…:{props.selectedUtxo.vout}
                    </span>
                    {". "}
                    {!props.supportsChange &&
                    props.impliedFeeSats !== null &&
                    props.impliedFeeSats > MAX_SAFE_IMPLIED_FEE_SATS ? (
                      <span className="font-medium text-warning">
                        Change setup needed
                      </span>
                    ) : (
                      <>
                        fee {formatSats(props.effectiveFeeSats)} BTC
                        {props.supportsChange && props.changeSats !== null && props.changeSats > 0n ? (
                          <> · change {formatSats(props.changeSats)} BTC</>
                        ) : null}
                        <InfoTip
                          label="How the fee is picked"
                          width="md"
                          size="xs"
                          side="end"
                        >
                          <span className="block">
                            Bitcoin spends one UTXO and returns the remainder
                            to your wallet as change.
                          </span>
                        </InfoTip>
                      </>
                    )}
                  </span>
                )}
              </>
            }
          />
        </section>

        {/* Recipient card. Same merged-mobile / split-lg+
            treatment as Amount above. */}
        <section
          className={
            "flex flex-col gap-3 " +
            "lg:rounded-card lg:border lg:border-border-soft lg:bg-surface-raised lg:p-4 lg:shadow-card-rest"
          }
        >
          <label
            htmlFor="btc-destination"
            className="flex flex-col gap-1"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              To
            </span>
            <input
              id="btc-destination"
              type="text"
              value={props.destination}
              onChange={(e) => props.setDestination(e.target.value)}
              placeholder={props.network === "mainnet" ? "bc1q…" : "tb1q…"}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              autoComplete="off"
              className={
                "w-full rounded-card border border-border-soft bg-canvas px-4 py-3 font-mono text-sm text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
            {props.destinationError && (
              <span className="text-[11px] text-warning" role="alert">
                {props.destinationError}
              </span>
            )}
          </label>

          <label
            htmlFor="btc-note"
            className="flex flex-col gap-1"
          >
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {SEND_NOTE_LABEL}
            </span>
            <input
              id="btc-note"
              type="text"
              value={props.note}
              onChange={(e) =>
                props.setNote(e.target.value.slice(0, SEND_NOTE_MAX_LENGTH))
              }
              placeholder={SEND_NOTE_PLACEHOLDER}
              maxLength={SEND_NOTE_MAX_LENGTH}
              className={
                "w-full rounded-card border border-border-soft bg-canvas px-4 py-3 text-sm text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
          </label>
        </section>
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
          <Button
            onClick={props.onSend}
            disabled={props.sending || props.autoUpgrading || !props.canSubmit}
            variant="primary"
            fullWidth
            size="lg"
          >
            {props.sending || props.autoUpgrading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {props.autoUpgrading && !props.sending ? "Preparing…" : "Sending…"}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" aria-hidden="true" />
                Send request
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  );
}

function BitcoinSetupPendingCard({
  walletName,
  proposal,
}: {
  walletName: string;
  proposal: string | null;
}) {
  return (
    <aside className="rounded-card border border-accent/35 bg-accent/[0.07] p-4 text-sm text-text-soft shadow-card-rest">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-semibold text-text-strong">
            Bitcoin setup requested
          </p>
          <p className="mt-1">
            Waiting for approval. When it is approved, BTC sends will return
            change automatically.
          </p>
          {proposal ? (
            <p className="mt-2 font-mono text-[11px] text-text-soft">
              {shortHash(proposal)}
            </p>
          ) : null}
        </div>
        <Link
          href={`/app/wallet/${encodeURIComponent(walletName)}/activity`}
          className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/[0.12] px-4 text-xs font-semibold text-accent transition-colors hover:bg-accent/[0.18]"
        >
          View activity
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </aside>
  );
}

function SentCard({
  sent,
  walletDisplay,
  walletName,
  network,
  onAnother,
}: {
  sent: {
    amountBtc: string;
    to: string;
    note: string;
    txid: string | null;
    explorerUrl: string | null;
  };
  walletDisplay: string;
  walletName: string;
  network: string;
  onAnother: () => void;
}) {
  const networkLabel =
    network === "mainnet" ? "Bitcoin" : `Bitcoin ${network}`;
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Network", value: networkLabel },
  ];
  if (sent.txid) {
    details.push({
      label: "Tx id",
      value: shortHash(sent.txid),
      mono: true,
      copyText: sent.txid,
    });
  }
  if (sent.note) {
    details.push({ label: "Note", value: sent.note });
  }
  return (
    <SendReceipt
      status="confirmed"
      statusLabel={`Broadcast on ${networkLabel}`}
      amount={sent.amountBtc}
      ticker="BTC"
      recipientLabel={sent.to}
      details={details}
      explorerHref={sent.explorerUrl}
      explorerLabel={bitcoinExplorerLabel(network as BitcoinNetwork)}
      actions={[
        {
          label: "Send another",
          hint: "Same wallet, different recipient.",
          onClick: onAnother,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "View activity",
          hint: "See approvals coming in.",
          href: `/app/wallet/${encodeURIComponent(walletName)}`,
        },
      ]}
    />
  );
}

function AwaitingApprovalCard({
  request,
  walletDisplay,
  walletName,
  onAnother,
}: {
  request: {
    amountBtc: string;
    to: string;
    proposal: string;
  };
  walletDisplay: string;
  walletName: string;
  onAnother: () => void;
}) {
  const details: ReceiptDetail[] = [
    { label: "From", value: walletDisplay },
    { label: "Status", value: "Waiting for approvals" },
    {
      label: "Proposal",
      value: shortHash(request.proposal),
      mono: true,
      copyText: request.proposal,
    },
  ];
  return (
    <SendReceipt
      status="pending"
      statusLabel="Request created"
      amount={request.amountBtc}
      ticker="BTC"
      recipientLabel={request.to}
      details={details}
      actions={[
        {
          label: "View activity",
          hint: "See the request and approval status.",
          href: `/app/wallet/${encodeURIComponent(walletName)}/activity`,
          primary: true,
          icon: ArrowRight,
        },
        {
          label: "New request",
          hint: "Compose another Bitcoin request.",
          onClick: onAnother,
        },
      ]}
    />
  );
}

function shortHash(s: string): string {
  if (s.length <= 16) return s;
  return `${s.slice(0, 8)}…${s.slice(-6)}`;
}

function buildBtcPreviewDetails(args: {
  walletDisplay: string;
  destination: string;
  amountBtc: string;
  selectedUtxo: EsploraUtxo | null;
  impliedFeeSats: bigint | null;
  effectiveFeeSats: bigint | null;
  changeSats: bigint | null;
  supportsChange: boolean;
  note: string;
}): SignPayloadDetail[] {
  const details: SignPayloadDetail[] = [
    { label: "From wallet", value: args.walletDisplay },
    { label: "Network", value: "Bitcoin", },
  ];
  const destination = args.destination.trim();
  if (destination) {
    details.push({
      label: "Recipient address",
      value: shortBtcAddress(destination),
      emphasis: "mono",
    });
  }
  if (args.amountBtc.trim()) {
    details.push({
      label: "Amount",
      value: `${args.amountBtc.trim()} BTC`,
      emphasis: "amount",
    });
  }
  if (args.selectedUtxo && args.effectiveFeeSats !== null) {
    const unsafeFee =
      !args.supportsChange &&
      args.impliedFeeSats !== null &&
      args.impliedFeeSats > MAX_SAFE_IMPLIED_FEE_SATS;
    details.push({
      label: unsafeFee ? "Blocked fee" : "Network fee",
      value: `${formatSats(args.effectiveFeeSats)} BTC`,
    });
    if (args.supportsChange && args.changeSats !== null && args.changeSats > 0n) {
      details.push({
        label: "Change",
        value: `${formatSats(args.changeSats)} BTC back to this wallet`,
      });
    }
  }
  if (args.note.trim()) {
    details.push({
      label: "Note",
      value: args.note.trim(),
    });
  }
  return details;
}

function buildBtcWarning(args: {
  selectedUtxo: EsploraUtxo | null;
  impliedFeeSats: bigint | null;
  supportsChange: boolean;
}): string | undefined {
  void args;
  return undefined;
}

// ─── error banner ─────────────────────────────────────────────────
//
// Persistent inline banner shown when a send mutation fails. Replaces
// the ephemeral toast as the primary surface for the diagnostic so
// users can:
//   - Read the friendly title + body without it auto-dismissing.
//   - Expand "Show technical details" to see the raw CLI stderr ,
//     critical for forwarding to upstream (e.g. the Ika devrel
//     thread when the secp256k1 sign path fails on BTC + ETH).
//   - "Start fresh attempt" clears destination/amount/UI errors so
//     a retry isn't polluted by stale form state. (Note: the failed
//     proposal stays on chain; framework-level proposal cleanup is
//     broken in this Quasar version. Hitting Send again with
//     different params will create a NEW
//     proposal, which is what we want here.)

function SendErrorBanner({
  error,
  onReset,
  onDismiss,
}: {
  error: { title: string; body: string; stderr?: string };
  onReset: () => void;
  onDismiss: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      role="alert"
      className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-text-strong"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <p className="font-semibold">{error.title}</p>
          <p className="mt-1 text-text-soft">{error.body}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="-mr-1 -mt-1 rounded-md p-1 text-text-soft hover:text-text-strong"
          aria-label="Dismiss error"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      {error.stderr && (
        <details
          className="mt-3 text-xs"
          open={expanded}
          onToggle={(e) => setExpanded((e.target as HTMLDetailsElement).open)}
        >
          <summary className="cursor-pointer text-text-soft hover:text-text-strong">
            Show technical details
          </summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-3 font-mono text-[11px] leading-relaxed text-text-soft">
            {error.stderr.trim()}
          </pre>
        </details>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onReset}>
          Start fresh attempt
        </Button>
        {error.stderr && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              void navigator.clipboard
                .writeText(error.stderr ?? "")
                .catch(() => {
                  // ignore clipboard rejection (Safari permissions etc.)
                });
            }}
          >
            Copy details
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────────────────────

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += (bytes[i] ?? 0).toString(16).padStart(2, "0");
  }
  return s;
}

function u32LeBytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function shortBtcAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function btcBalanceStatusLabel(
  error: Error | null | undefined,
  network: BitcoinNetwork,
): string {
  if (!error) return `No balance source on ${network}`;
  const message = error.message.toLowerCase();
  if (message.includes("404")) return `No UTXOs on ${network}`;
  if (message.includes("failed to fetch") || message.includes("network")) {
    return `${network} RPC unavailable`;
  }
  if (message.includes("429") || message.includes("rate")) {
    return `${network} indexer rate-limited`;
  }
  if (message.includes("500") || message.includes("502") || message.includes("503")) {
    return `${network} indexer unavailable`;
  }
  return `Check ${network} balance`;
}

async function waitForProposalStatus(
  connection: Parameters<typeof fetchProposal>[0],
  proposalPda: string,
): Promise<ProposalStatus | null> {
  for (let i = 0; i < 6; i++) {
    try {
      const proposal = await fetchProposal(connection, new PublicKey(proposalPda));
      if (proposal) return proposal.status;
    } catch {
      // Keep waiting; RPC read lag should not trigger an early broadcast.
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (i + 1)));
  }
  return null;
}

async function waitForProposalStatusOneOf(
  connection: Parameters<typeof fetchProposal>[0],
  proposalPda: string,
  accepted: readonly ProposalStatus[],
): Promise<ProposalStatus | null> {
  for (let i = 0; i < 12; i++) {
    try {
      const proposal = await fetchProposal(connection, new PublicKey(proposalPda));
      if (proposal && accepted.includes(proposal.status)) return proposal.status;
      if (
        proposal &&
        (proposal.status === ProposalStatus.Cancelled ||
          proposal.status === ProposalStatus.Executed)
      ) {
        return proposal.status;
      }
    } catch {
      // Keep waiting; RPC read lag is common right after a signed write.
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
  }
  return null;
}

async function waitForIntentParamCount(
  connection: Parameters<typeof fetchIntent>[0],
  walletPda: PublicKey,
  intentIndex: number,
  minParams: number,
): Promise<boolean> {
  for (let i = 0; i < 12; i++) {
    try {
      const intent = await fetchIntent(connection, walletPda, intentIndex);
      if ((intent.account?.params.length ?? 0) >= minParams) return true;
    } catch {
      // keep waiting for RPC/account propagation
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (i + 1)));
  }
  return false;
}
