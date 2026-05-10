"use client";

// Bitcoin (P2WPKH) send + setup, fused into one page.
//
// Mirrors the eth flow's two halves (`/setup/eth` then `/send/eth`)
// in a single component because Bitcoin's intent template is fixed
// (single-input, single-output, no fee param — fee is implicit) and
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
//   2. We auto-pick the largest single UTXO that covers the amount + a
//      conservative fee floor (1000 sats — signet/testnet fees are
//      tiny). Single-input, single-output: the fee is implicit
//      (`prev_amount_sats - send_amount_sats`).
//   3. Build proposal params, propose+auto-approve, execute with
//      `broadcast=true`. Backend forwards to mempool.space's Esplora
//      `POST /tx`.
//
// Network: signet by default, matching the CLI's default and the
// `cli/src/chains/bitcoin.rs` test path. The wallet's chain binding
// returns either testnet or mainnet addresses; we read the binding
// at runtime to decide which network the dWallet is bound to. (For
// pre-alpha all wallets come up on signet/testnet — `tb` HRP — so
// `validateBtcDestination` accepts both.)

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
  Send,
  X,
} from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { IntentType } from "@/lib/msig";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import { backendApi } from "@/lib/api/endpoints";
import { BackendApiError } from "@/lib/api/client";
import { friendlyError } from "@/lib/api/errors";
import { encryptPolicyBatch } from "@/lib/encrypt/client";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useToast } from "@/components/ui/Toast";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { chainByKind } from "@/lib/retail/chains";
import { appConfig } from "@/lib/config";
import {
  DEFAULT_BITCOIN_NETWORK,
  decodeSegwitAddress,
  detectBitcoinNetwork,
  esploraBaseUrl,
  fetchBitcoinBalance,
  fetchBitcoinUtxos,
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
/// Conservative fee floor — signet/testnet routinely accept ≤200 sats
/// but we leave headroom so a stale Esplora UTXO snapshot doesn't
/// trigger a "min relay fee not met" rejection on broadcast.
const FEE_RESERVE_SATS = 1000n;

interface BroadcastResultLike {
  chain_kind?: number;
  tx_id?: string;
  raw_tx_hex?: string;
}

export default function BitcoinSendPageWrapper() {
  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <BitcoinSendPage />
    </main>
  );
}

function BitcoinSendPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);
  const router = useRouter();
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

  // Pre-alpha runs against Solana DEVNET + Ika's mock signer, so
  // every BTC binding here is testnet-class (the backend returns
  // both `btc_p2wpkh_mainnet` and `btc_p2wpkh_testnet` for the same
  // HASH160; chainAddress already prefers the tb-HRP form). The `tb`
  // HRP is shared between testnet3 and signet though, so we have to
  // probe both Esplora endpoints to find which one actually has the
  // user's UTXOs. Default `testnet` while the probe runs so the page
  // can render skeletons; the network query swaps in once it lands.
  const networkQuery = useQuery({
    queryKey: ["btc-network-detect", dwalletAddress ?? "none"],
    queryFn: () =>
      dwalletAddress
        ? detectBitcoinNetwork(dwalletAddress)
        : DEFAULT_BITCOIN_NETWORK,
    enabled: !!dwalletAddress,
    // The detection is essentially "what faucet did the user use?" —
    // it doesn't change after the first funded UTXO lands, so we can
    // cache aggressively. 5 min is long enough to not re-probe on
    // every focus, short enough to pick up a switch if the user
    // suddenly funds the other chain.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
  const btcNetwork: BitcoinNetwork =
    networkQuery.data ?? DEFAULT_BITCOIN_NETWORK;

  // sender_pkh: HASH160(dwallet pubkey) = the witness program of the
  // dWallet's own P2WPKH address. We extract by decoding the address
  // we already have from the binding rather than re-deriving from
  // the raw pubkey — the backend already did that math on bind.
  const senderPkhHex = useMemo<string | null>(() => {
    if (!dwalletAddress) return null;
    const decoded = decodeSegwitAddress(dwalletAddress);
    if (!decoded || decoded.version !== 0 || decoded.program.length !== 20) {
      return null;
    }
    return bytesToHex(decoded.program);
  }, [dwalletAddress]);

  const btcIntent = useMemo(() => {
    return (intentsQuery.data ?? [])
      .map((it) => it.account)
      .find(
        (a) =>
          a !== null &&
          a.intentType === IntentType.Custom &&
          a.chainKind === BTC_CHAIN_KIND,
      );
  }, [intentsQuery.data]);

  // ── Live balance + UTXOs ──────────────────────────────────────────
  const balanceQuery = useQuery({
    queryKey: ["btc-balance", dwalletAddress ?? "none", btcNetwork],
    queryFn: () =>
      dwalletAddress ? fetchBitcoinBalance(dwalletAddress, btcNetwork) : 0n,
    enabled: !!dwalletAddress,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });
  const utxosQuery = useQuery({
    queryKey: ["btc-utxos", dwalletAddress ?? "none", btcNetwork],
    queryFn: () =>
      dwalletAddress ? fetchBitcoinUtxos(dwalletAddress, btcNetwork) : [],
    enabled: !!dwalletAddress,
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  // ── Form state ────────────────────────────────────────────────────
  const [destination, setDestination] = useState("");
  const [amountBtc, setAmountBtc] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [sentLabel, setSentLabel] = useState<{
    amountBtc: string;
    to: string;
    txid: string | null;
    explorerUrl: string | null;
  } | null>(null);
  // Inline error banner state. The toast version was too easy to miss
  // (auto-dismisses, no copy of the underlying CLI stderr) — this lets
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

  const sendAmountSats = useMemo<bigint | null>(
    () => parseBtcAmount(amountBtc),
    [amountBtc],
  );

  // Largest single UTXO that's ≥ requested amount + fee reserve.
  // Single-input simplicity matches the on-chain BTC template
  // (`examples/intents/btc_transfer.json`); multi-input would need a
  // template extension.
  const selectedUtxo = useMemo<EsploraUtxo | null>(() => {
    if (!utxosQuery.data || !sendAmountSats) return null;
    const need = sendAmountSats + FEE_RESERVE_SATS;
    // utxos are sorted desc by value; pick the smallest one that
    // covers `need`. Walking from the smallest up wastes less change
    // (single-input means change isn't returned — every extra sat
    // becomes the fee).
    const candidates = [...utxosQuery.data].sort((a, b) => a.value - b.value);
    for (const u of candidates) {
      if (BigInt(u.value) >= need) return u;
    }
    return null;
  }, [utxosQuery.data, sendAmountSats]);

  const impliedFeeSats = useMemo<bigint | null>(() => {
    if (!selectedUtxo || !sendAmountSats) return null;
    return BigInt(selectedUtxo.value) - sendAmountSats;
  }, [selectedUtxo, sendAmountSats]);

  // ── Mutations: setup intent (one-time), then send ─────────────────
  const setupIntent = useMutation({
    mutationFn: async () => {
      if (!wallet.publicKey) throw new Error("Connect your wallet first");
      if (!btcBinding) throw new Error("Bind Bitcoin to this wallet first");
      const addIntent = (intentsQuery.data ?? []).find(
        (it) => it.account?.intentType === IntentType.AddIntent,
      );
      const signerPk = addIntent?.account
        ? wallet.pickSigner(addIntent.account.approvers)
        : wallet.publicKey;
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list.",
        );
      }
      const me = signerPk.toBase58();
      const proposers = [me];
      const approvers = [me];
      const threshold = 1;
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
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          name,
          proposal,
          { actor_pubkey: me },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      await backendApi.executeProposal(name, proposal, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["wallet-intents"] });
      queryClient.invalidateQueries({ queryKey: ["wallet", name] });
      toast.success(`${toHeadingName(name)} can now send Bitcoin`);
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
      const signerPk = wallet.pickSigner(btcIntent.proposers);
      if (!signerPk) {
        throw new Error(
          "None of your connected wallets is in this wallet's approver list.",
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
      //     (LE — display-reversed).
      // The on-chain BIP143 builder
      // (`programs/clear-wallet/src/chains/bitcoin.rs:44`) is explicit
      // about wanting internal byte order. We reverse the Esplora hex
      // before stuffing it into the bytes32 param so the sighash
      // computed on chain references the same UTXO Bitcoin's
      // mempool will look up at broadcast time.
      const prevTxidInternal = reverseHex(selectedUtxo.txid);

      const dry = await backendApi.prepare.createProposal(name, {
        intent_index: btcIntent.intentIndex,
        params: [
          `prev_txid=0x${prevTxidInternal}`,
          `prev_vout=${selectedUtxo.vout}`,
          `prev_amount_sats=${selectedUtxo.value}`,
          `sender_pkh=0x${senderPkhHex}`,
          `recipient_pkh=0x${bytesToHex(dest.pkh)}`,
          `send_amount_sats=${sendAmountSats.toString()}`,
        ],
        actor_pubkey: signerPk.toBase58(),
      });
      const signed = await signDescriptor(dry, { preferSigner: signerPk });
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
      const decision = await approveIfNeeded(connection, proposal);
      if (decision.needsApproveSignature) {
        const approveDry = await backendApi.prepare.approveProposal(
          name,
          proposal,
          { actor_pubkey: signerPk.toBase58() },
        );
        const approveSigned = await signDescriptor(approveDry, {
          preferSigner: signerPk,
        });
        await backendApi.submit.approveProposal(name, proposal, {
          ...approveSigned,
          expiry: approveDry.expiry,
        });
      }
      const executed = await backendApi.executeProposal(name, proposal, {
        broadcast: true,
        dwallet_program: appConfig.preAlpha.dwalletProgramId,
        grpc_url: appConfig.preAlpha.grpcUrl,
        // BTC needs an ESPLORA URL (POST /tx), not a JSON-RPC URL.
        // The backend's `default_destination_rpc_url` is set up for
        // EVM (publicnode.com / 1RPC etc) — using that for BTC would
        // POST `eth_sendRawTransaction` JSON to mempool.space's
        // `/tx` endpoint and 400 immediately. We pass the
        // network-specific mempool.space Esplora URL explicitly so
        // the CLI's `cli/src/chains/bitcoin.rs::broadcast_tx`
        // adapter hits the right endpoint regardless of whatever
        // EVM default the backend env carries.
        rpc_url: esploraBaseUrl(btcNetwork),
      });
      const broadcast = (executed as { broadcast?: BroadcastResultLike })
        ?.broadcast;
      return { proposal, broadcast };
    },
    onSuccess: ({ broadcast }) => {
      const txid = broadcast?.tx_id ?? null;
      const explorerUrl = txid ? mempoolSpaceTxUrl(txid, btcNetwork) : null;
      setSentLabel({
        amountBtc: amountBtc.trim(),
        to: shortBtcAddress(destination.trim()),
        txid,
        explorerUrl,
      });
      // Refresh balance + UTXOs so the next send sees the spent state.
      void queryClient.invalidateQueries({
        queryKey: ["btc-balance", dwalletAddress ?? "none", btcNetwork],
      });
      void queryClient.invalidateQueries({
        queryKey: ["btc-utxos", dwalletAddress ?? "none", btcNetwork],
      });
    },
    onError: (err, _vars, _ctx) => {
      console.error("[send-btc]", err);
      const fe = friendlyError(err, "send");
      // Toast still fires (matches the rest of the app's send flows),
      // but the inline banner is the durable surface for the stderr —
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
    // Clear any prior error banner — a fresh attempt deserves a clean
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
      const max = utxosQuery.data?.[0]?.value ?? 0;
      setAmountError(
        `No single UTXO covers ${formatSats(sendAmountSats)} BTC + fee reserve (${formatSats(FEE_RESERVE_SATS)} BTC). Largest UTXO: ${formatSats(BigInt(max))} BTC.`,
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
    !blockedByDisconnect && !blockedByLedger && !isLoading && btcBinding && !btcIntent;
  const ready =
    !blockedByDisconnect && !blockedByLedger && !isLoading && btcBinding && btcIntent;

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: walletDisplay,
              href: `/app/wallet/${encodeURIComponent(name)}`,
            },
            {
              label: "Send",
              href: `/app/wallet/${encodeURIComponent(name)}/send`,
            },
            { label: "Bitcoin" },
          ]}
        />
      </StickyTopBar>
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.3 }}
        className="mx-auto flex w-full max-w-md flex-col gap-6 px-gutter"
      >
        <header className="flex flex-col items-center gap-3 text-center">
          {btcMeta && <ChainBadge chain={btcMeta} size="lg" />}
          <div>
            <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
              Send Bitcoin
            </h1>
            <p className="mt-1 text-sm text-text-soft">
              From {walletDisplay} on {btcNetwork}.
            </p>
          </div>
        </header>

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
            balanceSats={balanceQuery.data ?? null}
            onSetup={() => setupIntent.mutate()}
            busy={setupIntent.isPending}
            reduce={!!reduce}
          />
        )}
        {ready && !sentLabel && sendError && (
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
        {ready && !sentLabel && (
          <ComposeForm
            destination={destination}
            setDestination={setDestination}
            destinationError={destinationError}
            amountBtc={amountBtc}
            setAmountBtc={setAmountBtc}
            amountError={amountError}
            balanceSats={balanceQuery.data ?? null}
            balanceLoading={balanceQuery.isLoading}
            selectedUtxo={selectedUtxo}
            impliedFeeSats={impliedFeeSats}
            address={dwalletAddress}
            network={btcNetwork}
            sending={send.isPending}
            onSend={handleSend}
          />
        )}
        {sentLabel && (
          <SentCard
            sent={sentLabel}
            onAnother={() => {
              setSentLabel(null);
              setDestination("");
              setAmountBtc("");
            }}
            onBack={() =>
              router.push(
                `/app/wallet/${encodeURIComponent(name)}`,
              )
            }
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
      <p className="text-sm text-text-soft">
        This wallet isn&rsquo;t bound to Bitcoin yet. Add the Bitcoin chain
        first — that runs a one-time Ika DKG so the wallet has a Bitcoin
        address.
      </p>
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=bitcoin_p2wpkh`}
        className="self-start"
      >
        <Button>
          Add Bitcoin chain
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
  onSetup,
  busy,
  reduce,
}: {
  walletDisplay: string;
  address: string | null;
  balanceSats: bigint | null;
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
      <p className="text-sm text-text-soft">
        One-time setup: register the Bitcoin spending intent for{" "}
        <span className="font-medium text-text-strong">{walletDisplay}</span>.
        After this, sends use the same propose-approve-execute ceremony you
        use for SOL and ETH.
      </p>
      {address && (
        <div className="rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Bitcoin address
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
            {address}
          </p>
          {balanceSats !== null && (
            <p className="mt-2 font-numerals text-[11px] tabular-nums text-text-soft">
              Balance: {formatSats(balanceSats)} BTC
            </p>
          )}
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
            Enable Bitcoin sends
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
  amountError: string | null;
  balanceSats: bigint | null;
  balanceLoading: boolean;
  selectedUtxo: EsploraUtxo | null;
  impliedFeeSats: bigint | null;
  address: string | null;
  network: BitcoinNetwork;
  sending: boolean;
  onSend: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="btc-destination"
          className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
        >
          Recipient
        </label>
        <input
          id="btc-destination"
          type="text"
          value={props.destination}
          onChange={(e) => props.setDestination(e.target.value)}
          placeholder={
            props.network === "mainnet" ? "bc1q…" : "tb1q…"
          }
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-sm text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {props.destinationError && (
          <p className="text-[11px] text-warning">{props.destinationError}</p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-end justify-between gap-2">
          <label
            htmlFor="btc-amount"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Amount (BTC)
          </label>
          {props.balanceSats !== null && (
            <span className="font-numerals text-[10px] tabular-nums text-text-soft">
              Balance: {formatSats(props.balanceSats)} BTC
            </span>
          )}
        </div>
        <input
          id="btc-amount"
          type="text"
          inputMode="decimal"
          value={props.amountBtc}
          onChange={(e) => props.setAmountBtc(e.target.value)}
          placeholder="0.00"
          spellCheck={false}
          autoComplete="off"
          className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-numerals text-base tabular-nums text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
        {props.amountError && (
          <p className="text-[11px] text-warning">{props.amountError}</p>
        )}
        {props.selectedUtxo && props.impliedFeeSats !== null && (
          <div className="rounded-soft border border-border-soft bg-canvas p-2 text-[10px] text-text-soft">
            <p>
              Using UTXO{" "}
              <span className="font-mono text-text-strong">
                {props.selectedUtxo.txid.slice(0, 8)}…:{props.selectedUtxo.vout}
              </span>
              {" — "}
              {formatSats(BigInt(props.selectedUtxo.value))} BTC
            </p>
            <p className="mt-0.5">
              Implicit fee: {formatSats(props.impliedFeeSats)} BTC
            </p>
          </div>
        )}
      </div>

      <Button
        onClick={props.onSend}
        disabled={props.sending}
        fullWidth
        size="lg"
      >
        {props.sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Sending…
          </>
        ) : (
          <>
            <Send className="h-4 w-4" aria-hidden="true" />
            Send Bitcoin
          </>
        )}
      </Button>

      <p className="text-[10px] text-text-soft">
        Single-input, single-output P2WPKH transfer. Fee is implicit
        (input value − output value); we pick the smallest UTXO that
        covers your amount + a {Number(FEE_RESERVE_SATS)} sat fee floor.
      </p>
    </section>
  );
}

function SentCard({
  sent,
  onAnother,
  onBack,
}: {
  sent: {
    amountBtc: string;
    to: string;
    txid: string | null;
    explorerUrl: string | null;
  };
  onAnother: () => void;
  onBack: () => void;
}) {
  return (
    <section className="flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
      </div>
      <div className="text-center">
        <p className="font-display text-lg font-semibold text-text-strong">
          {sent.amountBtc} BTC sent
        </p>
        <p className="mt-1 text-sm text-text-soft">
          To <span className="font-mono">{sent.to}</span>
        </p>
      </div>
      {sent.explorerUrl && (
        <a
          href={sent.explorerUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center justify-center gap-1.5 self-center rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          View on mempool.space
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
      <div className="flex flex-col gap-2">
        <Button onClick={onAnother} fullWidth variant="ghost">
          Send another
        </Button>
        <Button onClick={onBack} fullWidth>
          Back to wallet
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </section>
  );
}

// ─── error banner ─────────────────────────────────────────────────
//
// Persistent inline banner shown when a send mutation fails. Replaces
// the ephemeral toast as the primary surface for the diagnostic so
// users can:
//   - Read the friendly title + body without it auto-dismissing.
//   - Expand "Show technical details" to see the raw CLI stderr —
//     critical for forwarding to upstream (e.g. the Ika devrel
//     thread when the secp256k1 sign path fails on BTC + ETH).
//   - "Start fresh attempt" clears destination/amount/UI errors so
//     a retry isn't polluted by stale form state. (Note: the failed
//     proposal stays on chain; framework-level proposal cleanup is
//     broken in this Quasar version — see CLAUDE.md "Known issues".
//     Hitting Send again with different params will create a NEW
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

function shortBtcAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}
