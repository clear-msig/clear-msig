"use client";

// /app/secure/[recovery]/sweep — full in-app sweep wizard (v3e).
//
// Three stages:
//   1. compose  — destination address + SOL amount.
//   2. review   — preview card (from / to / amount / message size).
//   3. running  — runs propose+approve → execute → presign+sign →
//                 broadcast in sequence, with live progress dots.
//   4. done     — explorer pills for the proposal, execute, and the
//                 actual sweep broadcast.
//
// Two user popups: one for the propose+approve bundle, one for the
// execute. The presign+sign step is a gRPC-Web round trip with no
// user interaction. Broadcast happens automatically once the network
// signature lands.
//
// Pre-conditions enforced by the action layer:
//   - the connected wallet is on the roster (solo at v3e)
//   - the v3a-saved DKG attestation includes `dwalletAddr` (anything
//     post-v3d does)
//   - vault threshold = 1
// Anything else fails fast with a useful message in the toast.

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { useToast } from "@/components/ui/Toast";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import { loadAttestation } from "@/lib/ikavery/clearmsig-attestations";
import { buildSweepMessage, transferSol } from "@/lib/ikavery/sweep/message";
import {
  runInAppSweep,
  type SweepStage as ActionStage,
} from "@/lib/ikavery/clearmsig-sweep";

const LAMPORTS_PER_SOL = 1_000_000_000n;

type Stage = "compose" | "review" | "running" | "done";

const RUN_STAGES: { id: ActionStage; label: string; detail: string }[] = [
  {
    id: "build",
    label: "Building sweep",
    detail: "Encoding the SOL transfer + structural intent digest.",
  },
  {
    id: "propose-approve-sign",
    label: "Sign propose + approve",
    detail: "Confirm the bundle in your wallet.",
  },
  {
    id: "propose-approve-confirm",
    label: "Submitting propose + approve",
    detail: "Recording the proposal on Solana.",
  },
  {
    id: "execute-sign",
    label: "Sign execute",
    detail: "Authorising the dWallet message approval CPI.",
  },
  {
    id: "execute-confirm",
    label: "Submitting execute",
    detail: "Confirming the MessageApproval row on chain.",
  },
  {
    id: "presign-sign",
    label: "Ika network sign",
    detail: "Asking the Ika network to sign the sweep with the dWallet key.",
  },
  {
    id: "broadcast",
    label: "Broadcasting sweep",
    detail: "Sending the dWallet-signed sweep to a Solana RPC.",
  },
  {
    id: "broadcast-confirm",
    label: "Waiting for confirmation",
    detail: "Solana confirms the funds have moved.",
  },
];

export default function SweepPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SweepPage />
    </Suspense>
  );
}

function SweepPage() {
  const reduce = useReducedMotion();
  const params = useParams<{ recovery: string }>();
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();

  const recoveryStr = useMemo(() => {
    try {
      return decodeURIComponent(params?.recovery ?? "");
    } catch {
      return params?.recovery ?? "";
    }
  }, [params?.recovery]);

  const recoveryPk = useMemo(() => {
    try {
      return new PublicKey(recoveryStr);
    } catch {
      return null;
    }
  }, [recoveryStr]);

  const vaultQuery = useQuery({
    queryKey: ["ikavery-vault", recoveryStr],
    queryFn: () => {
      if (!recoveryPk) throw new Error("Invalid recovery address");
      return fetchVault(connection, recoveryPk);
    },
    enabled: !!recoveryPk,
    staleTime: 30_000,
  });

  const attestation = useMemo(
    () => (recoveryStr ? loadAttestation(recoveryStr) : null),
    [recoveryStr],
  );
  const dwalletPubkey = useMemo<PublicKey | null>(() => {
    if (!attestation) return null;
    try {
      return new PublicKey(attestation.publicKey);
    } catch {
      return null;
    }
  }, [attestation]);

  // The dWallet pays the broadcast tx fee (it's the only signer in
  // the final tx). Show the live balance so the user knows the cap,
  // and let "Max" set the amount to balance minus a 5000-lamport fee
  // reserve. 5000 = current Solana single-signature base fee.
  const FEE_RESERVE_LAMPORTS = 5_000n;
  const dwalletBalanceQ = useQuery({
    queryKey: ["ikavery-dwallet-balance", dwalletPubkey?.toBase58() ?? "none"],
    queryFn: async () => {
      if (!dwalletPubkey) return null;
      return connection.getBalance(dwalletPubkey, "confirmed");
    },
    enabled: !!dwalletPubkey,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
  });

  const [stage, setStage] = useState<Stage>("compose");
  const [destination, setDestination] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [previewMessageBytes, setPreviewMessageBytes] =
    useState<Uint8Array | null>(null);
  const [runStage, setRunStage] = useState<ActionStage | null>(null);
  const [proposeSig, setProposeSig] = useState<string | null>(null);
  const [executeSig, setExecuteSig] = useState<string | null>(null);
  const [broadcastSig, setBroadcastSig] = useState<string | null>(null);

  const lamports = useMemo<bigint | null>(() => {
    const trimmed = amountSol.trim();
    if (!trimmed) return null;
    if (!/^\d+(\.\d{0,9})?$/.test(trimmed)) return null;
    const [whole, frac = ""] = trimmed.split(".");
    const fracPadded = (frac + "000000000").slice(0, 9);
    try {
      const w = BigInt(whole ?? "0");
      const f = BigInt(fracPadded || "0");
      const v = w * LAMPORTS_PER_SOL + f;
      if (v <= 0n) return null;
      return v;
    } catch {
      return null;
    }
  }, [amountSol]);

  const destinationPk = useMemo<PublicKey | null>(() => {
    const trimmed = destination.trim();
    if (!trimmed) return null;
    try {
      return new PublicKey(trimmed);
    } catch {
      return null;
    }
  }, [destination]);

  const handleReview = () => {
    setDestinationError(null);
    setAmountError(null);
    if (!destinationPk) {
      setDestinationError("Enter a valid Solana address.");
      return;
    }
    if (!lamports) {
      setAmountError("Enter an amount in SOL (e.g. 0.5).");
      return;
    }
    if (!dwalletPubkey) {
      toast.error("dWallet attestation missing", {
        details:
          "v3a saves the dWallet pubkey to local storage on create. If you signed in on a fresh browser, the sweep needs that data — re-mint via /secure/new for now.",
      });
      return;
    }

    const ix = transferSol(dwalletPubkey, destinationPk, lamports);
    const { messageBytes } = buildSweepMessage({
      feePayer: dwalletPubkey,
      instructions: [ix],
    });
    setPreviewMessageBytes(messageBytes);
    setStage("review");
  };

  const handleRun = async () => {
    if (!destinationPk || !lamports || !recoveryPk) return;
    if (!vaultQuery.data) {
      toast.error("Vault not loaded yet");
      return;
    }
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (wallet.isLedger) {
      toast.error("Ledger not supported yet", {
        details:
          "Vault sweep needs full transaction signing. Use your Dynamic embedded wallet.",
      });
      return;
    }
    setRunStage("build");
    setStage("running");
    try {
      const result = await runInAppSweep({
        connection,
        recovery: recoveryPk,
        recoveryId: vaultQuery.data.account.recoveryId,
        creator: wallet.publicKey,
        destination: destinationPk,
        lamports,
        signTransaction: wallet.signTransaction,
        onProgress: (s) => setRunStage(s),
      });
      setProposeSig(result.proposeSig);
      setExecuteSig(result.executeSig);
      setBroadcastSig(result.broadcastSig);
      setRunStage(null);
      setStage("done");
    } catch (e) {
      console.error("[secure/sweep]", e);
      toast.error("Sweep failed", {
        details: e instanceof Error ? e.message : String(e),
      });
      setRunStage(null);
      setStage("review");
    }
  };

  if (!recoveryPk) {
    return (
      <div className="px-gutter">
        <p className="text-sm text-text-soft">Invalid vault address.</p>
      </div>
    );
  }
  const blockedByDisconnect = !wallet.connected;
  const blockedByLedger = wallet.isLedger;

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.4,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <motion.div {...fadeIn(0)} className="flex flex-col gap-8">
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      <div className="px-gutter">
        <Link
          href={`/app/secure/${encodeURIComponent(recoveryStr)}`}
          className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to vault
        </Link>
      </div>

      {blockedByDisconnect && (
        <PageEyebrow label="Sign in to continue" align="center">
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
            Connect a wallet first
          </h1>
          <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
            Sweep is authorised by the vault&rsquo;s roster. Sign in to
            compose one.
          </p>
          <Link
            href={`/connect?next=/app/secure/${encodeURIComponent(recoveryStr)}/sweep`}
            className="mt-5 inline-flex"
          >
            <Button size="lg">
              Sign in
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </PageEyebrow>
      )}

      {!blockedByDisconnect && blockedByLedger && (
        <PageEyebrow label="Ledger" align="center">
          <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
            Sweep needs a hot wallet
          </h1>
          <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
            clear-msig&rsquo;s Ledger path doesn&rsquo;t sign vault
            transactions yet. Use your Dynamic embedded wallet.
          </p>
        </PageEyebrow>
      )}

      {!blockedByDisconnect && !blockedByLedger && stage === "compose" && (
        <ComposeStage
          destination={destination}
          setDestination={setDestination}
          destinationError={destinationError}
          amountSol={amountSol}
          setAmountSol={setAmountSol}
          amountError={amountError}
          dwalletPubkey={dwalletPubkey?.toBase58() ?? null}
          recoveryShort={`${recoveryStr.slice(0, 4)}…${recoveryStr.slice(-4)}`}
          loading={vaultQuery.isLoading}
          balanceLamports={
            typeof dwalletBalanceQ.data === "number"
              ? BigInt(dwalletBalanceQ.data)
              : null
          }
          onMax={() => {
            if (typeof dwalletBalanceQ.data !== "number") return;
            const balance = BigInt(dwalletBalanceQ.data);
            if (balance <= FEE_RESERVE_LAMPORTS) {
              setAmountSol("0");
              return;
            }
            const maxLamports = balance - FEE_RESERVE_LAMPORTS;
            setAmountSol(formatLamportsToSol(maxLamports));
          }}
          onContinue={handleReview}
          reduce={!!reduce}
        />
      )}

      {!blockedByDisconnect && !blockedByLedger && stage === "review" && (
        <ReviewStage
          destination={destinationPk?.toBase58() ?? ""}
          amountSol={amountSol}
          dwalletPubkey={dwalletPubkey?.toBase58() ?? ""}
          messageBytesLen={previewMessageBytes?.length ?? 0}
          onBack={() => setStage("compose")}
          onContinue={handleRun}
          reduce={!!reduce}
        />
      )}

      {!blockedByDisconnect && !blockedByLedger && stage === "running" && (
        <RunningStage subStage={runStage} reduce={!!reduce} />
      )}

      {stage === "done" && (
        <DoneStage
          amountSol={amountSol}
          destination={destinationPk?.toBase58() ?? ""}
          proposeSig={proposeSig}
          executeSig={executeSig}
          broadcastSig={broadcastSig}
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}

interface ComposeStageProps {
  destination: string;
  setDestination: (v: string) => void;
  destinationError: string | null;
  amountSol: string;
  setAmountSol: (v: string) => void;
  amountError: string | null;
  dwalletPubkey: string | null;
  recoveryShort: string;
  loading: boolean;
  /** Live dWallet balance in lamports. Used for "Max" + helper text. */
  balanceLamports: bigint | null;
  onMax: () => void;
  onContinue: () => void;
  reduce: boolean;
}

function ComposeStage(props: ComposeStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 03 · sweep" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Sweep funds out
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Move SOL from the vault&rsquo;s dWallet to a destination address.
          Vault {props.recoveryShort}.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sweep-destination"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Destination address
          </label>
          <input
            id="sweep-destination"
            type="text"
            value={props.destination}
            onChange={(e) => props.setDestination(e.target.value)}
            placeholder="Solana address"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-sm text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {props.destinationError && (
            <p className="text-[11px] text-warning">{props.destinationError}</p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-2">
            <label
              htmlFor="sweep-amount"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
            >
              Amount (SOL)
            </label>
            {props.balanceLamports != null && (
              <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                Balance: {formatLamportsToSol(props.balanceLamports)} SOL
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="sweep-amount"
              type="text"
              inputMode="decimal"
              value={props.amountSol}
              onChange={(e) => props.setAmountSol(e.target.value)}
              placeholder="0.0"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-numerals text-base tabular-nums text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="button"
              onClick={props.onMax}
              disabled={props.balanceLamports == null}
              className={
                "shrink-0 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft " +
                "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              }
              title="Use max (balance minus fee reserve)"
            >
              Max
            </button>
          </div>
          {props.amountError && (
            <p className="text-[11px] text-warning">{props.amountError}</p>
          )}
        </div>

        <div className="rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            From
          </p>
          <p className="mt-1 break-all font-mono text-[11px] text-text-strong">
            {props.dwalletPubkey ?? "dWallet attestation missing"}
          </p>
        </div>
      </section>

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={props.onContinue} disabled={props.loading}>
          Review
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface ReviewStageProps {
  destination: string;
  amountSol: string;
  dwalletPubkey: string;
  messageBytesLen: number;
  onBack: () => void;
  onContinue: () => void;
  reduce: boolean;
}

function ReviewStage(props: ReviewStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 03 · sweep" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Confirm the sweep
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          The on-chain instruction is built. Review before you continue.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <dl className="flex flex-col gap-3">
          <Row label="Amount" value={`${props.amountSol} SOL`} mono={false} />
          <Row label="From" value={shortPub(props.dwalletPubkey)} title={props.dwalletPubkey} />
          <Row label="To" value={shortPub(props.destination)} title={props.destination} />
          <Row
            label="Message bytes"
            value={`${props.messageBytesLen} B`}
            mono={false}
          />
        </dl>
      </section>

      <div className="mx-auto flex items-center gap-2">
        <Button variant="ghost" onClick={props.onBack}>
          Back
        </Button>
        <Button size="lg" onClick={props.onContinue}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

function Row({
  label,
  value,
  title,
  mono = true,
}: {
  label: string;
  value: string;
  title?: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {label}
      </dt>
      <dd
        title={title}
        className={
          "min-w-0 flex-1 truncate text-right text-sm text-text-strong " +
          (mono ? "font-mono" : "font-numerals tabular-nums")
        }
      >
        {value}
      </dd>
    </div>
  );
}

interface RunningStageProps {
  subStage: ActionStage | null;
  reduce: boolean;
}

function RunningStage({ subStage, reduce }: RunningStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const activeIdx = subStage ? RUN_STAGES.findIndex((s) => s.id === subStage) : 0;
  const active = activeIdx >= 0 ? RUN_STAGES[activeIdx] : RUN_STAGES[0]!;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      <Loader2
        className="h-10 w-10 animate-spin text-accent"
        strokeWidth={1.5}
        aria-hidden="true"
      />
      <div className="flex flex-col items-center gap-1 text-center">
        <p className="font-display text-xl font-semibold text-text-strong">
          {active?.label ?? "Sweeping…"}
        </p>
        <p className="max-w-sm text-sm text-text-soft">
          {active?.detail ?? "Running through the sweep stages."}
        </p>
      </div>
      <ol
        className="flex items-center gap-1.5"
        aria-label="sweep progress"
      >
        {RUN_STAGES.map((s, i) => {
          const completed = activeIdx > i;
          const current = activeIdx === i;
          return (
            <li
              key={s.id}
              aria-label={s.label}
              className={
                "h-1.5 w-6 rounded-full " +
                (completed
                  ? "bg-accent"
                  : current
                    ? "bg-accent/60"
                    : "bg-border-soft")
              }
            />
          );
        })}
      </ol>
    </motion.section>
  );
}

interface DoneStageProps {
  amountSol: string;
  destination: string;
  proposeSig: string | null;
  executeSig: string | null;
  broadcastSig: string | null;
  reduce: boolean;
}

function DoneStage(props: DoneStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const explorer = (sig: string) =>
    `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 03 · sweep" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Funds moved
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          {props.amountSol} SOL is on its way to{" "}
          <span className="font-mono text-text-strong">
            {shortPub(props.destination)}
          </span>
          . Three Solana txs took it across the line.
        </p>
      </PageEyebrow>

      <ul className="mx-auto flex w-full max-w-md flex-col gap-2">
        <ExplorerRow
          label="Propose + approve"
          sig={props.proposeSig}
          href={props.proposeSig ? explorer(props.proposeSig) : null}
        />
        <ExplorerRow
          label="Execute (MessageApproval)"
          sig={props.executeSig}
          href={props.executeSig ? explorer(props.executeSig) : null}
        />
        <ExplorerRow
          label="Sweep broadcast"
          sig={props.broadcastSig}
          href={props.broadcastSig ? explorer(props.broadcastSig) : null}
          highlight
        />
      </ul>
    </motion.section>
  );
}

function ExplorerRow({
  label,
  sig,
  href,
  highlight,
}: {
  label: string;
  sig: string | null;
  href: string | null;
  highlight?: boolean;
}) {
  if (!sig || !href) return null;
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={
          "group flex items-center gap-3 rounded-card border bg-surface-raised p-3 shadow-card-rest " +
          "transition-[border-color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 " +
          (highlight
            ? "border-accent/60 hover:border-accent"
            : "border-border-soft hover:border-accent/40")
        }
      >
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            {label}
          </span>
          <span className="truncate font-mono text-[11px] text-text-strong">
            {sig}
          </span>
        </div>
        <ExternalLink
          className="h-4 w-4 shrink-0 text-text-soft transition-colors group-hover:text-accent"
          aria-hidden="true"
        />
      </a>
    </li>
  );
}

function shortPub(p: string): string {
  if (p.length < 10) return p;
  return `${p.slice(0, 4)}…${p.slice(-4)}`;
}

/**
 * Format `lamports` as a SOL string, trimming trailing zeros down to
 * 4 decimal places minimum. Used for the balance helper text and the
 * "Max" button population — both display contexts, never parsed back.
 */
function formatLamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  if (fracStr.length === 0) return whole.toString();
  // 4 decimals min so amounts like 0.05 don't render as "0.05" with a
  // truncated fractional tail that surprises a "Max"-then-edit user.
  const padded = fracStr.length >= 4 ? fracStr : fracStr.padEnd(4, "0");
  return `${whole}.${padded}`;
}
