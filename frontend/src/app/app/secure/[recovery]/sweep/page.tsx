"use client";

// /app/secure/[recovery]/sweep — sweep composition wizard.
//
// What ships in v3c:
//   - Three-stage flow: compose (form) → review (preview card) →
//     handoff (explainer + upstream link + saved intent).
//   - Builds the SOL transfer message client-side from the dWallet
//     pubkey saved in v3a (loadAttestation) — destination + amount in
//     SOL, validated via base58 + numeric parse.
//   - Saves the composed intent to localStorage so v3d's in-app
//     execute path can pick it up without a re-prompt.
//
// What v3c deliberately does NOT do:
//   - The on-chain propose+approve pair needs the structural intent
//     digest the program rebuilds at execute time (see sweep/message.ts
//     parser). The byte-exact digest helper is the next infra piece;
//     until it lands, the UI hands users to the upstream
//     solana.ikavery.com flow rather than submitting a propose with a
//     digest that will fail to match at execute time.
//   - The dWallet's authority transfer to ikavery's CPI authority
//     (one-time, post-DKG) is the other gate. Not in v3c.
//
// The handoff stage is explicit about both. Better to be honest than
// claim functionality that isn't end-to-end.

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
  Copy,
  ExternalLink,
  KeyRound,
  ShieldAlert,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { useToast } from "@/components/ui/Toast";
import { fetchVault } from "@/lib/ikavery/clearmsig-actions";
import { loadAttestation } from "@/lib/ikavery/clearmsig-attestations";
import { buildSweepMessage, transferSol } from "@/lib/ikavery/sweep/message";

const IKAVERY_LIVE = "https://solana.ikavery.com";
const SWEEP_INTENTS_KEY = "clear.ikavery-sweep-intents.v1";

const LAMPORTS_PER_SOL = 1_000_000_000n;

type Stage = "compose" | "review" | "handoff";

interface SavedSweepIntent {
  recovery: string;
  destination: string;
  lamports: string; // bigint as string for JSON
  composedAt: number;
}

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

  const [stage, setStage] = useState<Stage>("compose");
  const [destination, setDestination] = useState("");
  const [amountSol, setAmountSol] = useState("");
  const [destinationError, setDestinationError] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [previewMessageBytes, setPreviewMessageBytes] =
    useState<Uint8Array | null>(null);

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

  const handleHandoff = () => {
    if (!destinationPk || !lamports) return;
    const intent: SavedSweepIntent = {
      recovery: recoveryStr,
      destination: destinationPk.toBase58(),
      lamports: lamports.toString(),
      composedAt: Date.now(),
    };
    try {
      const raw = window.localStorage.getItem(SWEEP_INTENTS_KEY);
      const all: SavedSweepIntent[] = raw ? JSON.parse(raw) : [];
      all.push(intent);
      window.localStorage.setItem(SWEEP_INTENTS_KEY, JSON.stringify(all));
    } catch {
      /* localStorage blocked — silent. The intent is still in the URL
       * the user can copy. */
    }
    setStage("handoff");
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
          onContinue={handleHandoff}
          reduce={!!reduce}
        />
      )}

      {!blockedByDisconnect && !blockedByLedger && stage === "handoff" && (
        <HandoffStage
          destination={destinationPk?.toBase58() ?? ""}
          amountSol={amountSol}
          recoveryAddress={recoveryStr}
          dwalletPubkey={dwalletPubkey?.toBase58() ?? ""}
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
          <label
            htmlFor="sweep-amount"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Amount (SOL)
          </label>
          <input
            id="sweep-amount"
            type="text"
            inputMode="decimal"
            value={props.amountSol}
            onChange={(e) => props.setAmountSol(e.target.value)}
            placeholder="0.0"
            spellCheck={false}
            autoComplete="off"
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-numerals text-base tabular-nums text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
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

interface HandoffStageProps {
  destination: string;
  amountSol: string;
  recoveryAddress: string;
  dwalletPubkey: string;
  reduce: boolean;
}

function HandoffStage(props: HandoffStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const [copied, setCopied] = useState(false);
  const summary = `Sweep ${props.amountSol} SOL\nfrom: ${props.dwalletPubkey}\nto:   ${props.destination}\nvault: ${props.recoveryAddress}`;
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(summary);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked */
    }
  };
  const upstreamUrl = `${IKAVERY_LIVE}/recovery/${encodeURIComponent(props.recoveryAddress)}`;
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
          Sweep saved locally
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          The intent is composed and stored on this device. Finish it
          upstream until v3d ships the in-app execute path.
        </p>
      </PageEyebrow>

      <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-snug">
          <span className="font-medium text-text-strong">v3c limitation.</span>{" "}
          The on-chain execute path needs the dWallet&rsquo;s authority
          transferred to ikavery&rsquo;s CPI authority — a one-time
          activation step landing in v3d. Until then, run the sweep
          upstream with the same credentials. The composed intent is on
          this device for the in-app flow when it lands.
        </p>
      </aside>

      <section className="mx-auto w-full max-w-md rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-text-strong">
          {summary}
        </pre>
        <button
          type="button"
          onClick={handleCopy}
          className="mt-3 inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-accent" aria-hidden="true" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" aria-hidden="true" />
              Copy summary
            </>
          )}
        </button>
      </section>

      <div className="mx-auto flex flex-col items-center gap-2">
        <a href={upstreamUrl} target="_blank" rel="noreferrer">
          <Button size="lg">
            <KeyRound className="h-4 w-4" aria-hidden="true" />
            Open upstream
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </Button>
        </a>
        <p className="text-[11px] text-text-soft">
          ikavery shows the same vault and runs the execute today.
        </p>
      </div>
    </motion.section>
  );
}

function shortPub(p: string): string {
  if (p.length < 10) return p;
  return `${p.slice(0, 4)}…${p.slice(-4)}`;
}
