"use client";

// /app/secure/new - wizard for creating a new ikavery vault.
// (Route is /new, not /build, because the frontend's .gitignore
// has `build/` from a Next.js convention and would have hidden the
// file. Naming matches /app/wallet/[name]/policies/new.)
//
// Three user-facing stages, mirroring the existing /welcome
// create-wallet wizard:
//   1. shape    - pick a threshold preset (just-me / 2-of-3 / 3-of-5).
//   2. confirm  - preview card showing what we're about to sign and
//                 the "Build vault" CTA.
//   3. done     - success state + "Open vault" / "Build another".
//
// The "creating" sub-stage sits between confirm and done; it's not a
// user-driven step, just the engine running. The top stage strip
// folds it into "Confirm" so the user sees three big stages, not
// four.
//
// One signed write: the create_recovery instruction. Two signers in
// the tx - the user's connected wallet (creator + payer) and a
// throwaway recoveryId keypair (PDA seed). The throwaway is generated
// client-side and never referenced again.

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  Fingerprint,
  Loader2,
  ShieldCheck,
  User,
  Vault as VaultIcon,
} from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import {
  createMultiMemberVault,
  createSoloVault,
  fetchVault,
  type CreatePasskeyProgress,
  type CreateVaultStage,
} from "@/lib/ikavery/clearmsig-actions";

type Stage = "shape" | "confirm" | "creating" | "done";

interface ThresholdShape {
  id: "solo" | "2of3" | "3of5";
  label: string;
  threshold: number;
  members: number;
  blurb: string;
}

const SHAPES: ThresholdShape[] = [
  {
    id: "solo",
    label: "Just me",
    threshold: 1,
    members: 1,
    blurb: "Fastest setup.",
  },
  {
    id: "2of3",
    label: "2 of 3",
    threshold: 2,
    members: 3,
    blurb: "Any two sign.",
  },
  {
    id: "3of5",
    label: "3 of 5",
    threshold: 3,
    members: 5,
    blurb: "Three of five sign.",
  },
];

export default function SecureBuildPageWrapper() {
  return (
    <Suspense fallback={<div className="min-h-screen" aria-hidden="true" />}>
      <SecureBuildPage />
    </Suspense>
  );
}

function SecureBuildPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const wallet = useWallet();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Preselect the threshold shape when the user lands here from
  // /app/wallet/new's "Recover" branch (?preselect=solo|2of3|3of5).
  // When set, we skip the in-page shape picker and jump straight to
  // the confirm step — the user already made that choice on the
  // unified wallet-create entry. See Fesal feedback 2026-05-11.
  const searchParams = useSearchParams();
  const preselectedShape = useMemo<ThresholdShape | null>(() => {
    const id = searchParams?.get("preselect");
    if (!id) return null;
    return SHAPES.find((s) => s.id === id) ?? null;
  }, [searchParams]);

  const [stage, setStage] = useState<Stage>(
    preselectedShape ? "confirm" : "shape",
  );
  const [shape, setShape] = useState<ThresholdShape>(
    preselectedShape ?? SHAPES[0]!,
  );
  const [resultRecovery, setResultRecovery] = useState<string | null>(null);
  const [resultTxSig, setResultTxSig] = useState<string | null>(null);
  const [passkeyProgress, setPasskeyProgress] = useState<CreatePasskeyProgress | null>(null);
  const [createSubStage, setCreateSubStage] = useState<CreateVaultStage | null>(
    null,
  );

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

  const handleConfirm = () => {
    setStage("confirm");
  };

  const handleBuild = async () => {
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    // For multi-member shapes, the wizard fires `memberCount - 1`
    // passkey-create prompts back-to-back BEFORE DKG. Set the initial
    // sub-stage accordingly so the UI shows "Creating passkey 1 of N"
    // straight away instead of the DKG copy.
    setCreateSubStage(shape.members > 1 ? "create-passkey" : "dkg");
    setPasskeyProgress(null);
    setStage("creating");
    try {
      const result =
        shape.members === 1
          ? await createSoloVault({
              connection,
              creator: wallet.publicKey,
              threshold: shape.threshold,
              signTransaction: wallet.signTransaction,
              onProgress: (s) => setCreateSubStage(s),
            })
          : await createMultiMemberVault({
              connection,
              creator: wallet.publicKey,
              threshold: shape.threshold,
              memberCount: shape.members,
              signTransaction: wallet.signTransaction,
              onProgress: (s) => setCreateSubStage(s),
              onPasskeyProgress: (p) => setPasskeyProgress(p),
            });
      setResultRecovery(result.recovery.toBase58());
      setResultTxSig(result.txSignature);
      setCreateSubStage(null);
      setStage("done");

      // Pre-warm the vault detail page so clicking "Open vault" lands
      // on a populated page instead of the read-vault skeleton. Three
      // queries to fill, all in parallel:
      //   - vault account (already fetched once in the create flow,
      //     but persist into the listing's queryKey shape)
      //   - dwallet balance (0 lamports. We know this for a brand-new
      //     dWallet)
      //   - proposals list (empty. ProposalCount is 0)
      // All best-effort; failures are silent because the destination
      // page will refetch anyway.
      const recoveryStr = result.recovery.toBase58();
      const dwalletStr = new PublicKey(result.dwalletPubkey).toBase58();
      void Promise.allSettled([
        queryClient.prefetchQuery({
          queryKey: ["ikavery-vault", recoveryStr],
          queryFn: () => fetchVault(connection, result.recovery),
        }),
        queryClient.setQueryData(
          ["ikavery-dwallet-balance", dwalletStr],
          0,
        ),
        queryClient.setQueryData(
          ["ikavery-proposals", recoveryStr, 0],
          [],
        ),
        // Bust the listing query so the new vault shows up after the
        // user backs out, rather than waiting for the next focus-refetch.
        queryClient.invalidateQueries({
          queryKey: ["ikavery-vaults"],
        }),
      ]);
    } catch (e) {
      console.error("[secure/build]", e);
      toast.error("Couldn't build the vault", {
        details: e instanceof Error ? e.message : String(e),
      });
      setCreateSubStage(null);
      setPasskeyProgress(null);
      setStage("confirm");
    }
  };

  // Upfront gates so the user can't get stuck halfway through.
  // The wizard needs a connected wallet that can sign transactions.
  const blockedByDisconnect = !wallet.connected;
  const isBlocked = blockedByDisconnect;

  return (
    <motion.div
      {...fadeIn(0)}
      className="mx-auto flex w-full max-w-2xl flex-col gap-8"
    >
      {/* Stage progress strip - hidden when blocked / on done. The
          done state has its own resolution; the blocked states are
          terminal screens that don't need the strip. */}
      {!isBlocked && stage !== "done" && (
        <StageStrip stage={stage} />
      )}

      {blockedByDisconnect && <BlockedDisconnect />}
      {!isBlocked && stage === "shape" && (
        <ShapeStage
          shape={shape}
          setShape={setShape}
          onContinue={handleConfirm}
          reduce={!!reduce}
        />
      )}
      {!isBlocked && stage === "confirm" && (
        <ConfirmStage
          shape={shape}
          creatorAddress={wallet.publicKey?.toBase58() ?? ""}
          onBack={() => setStage("shape")}
          onBuild={handleBuild}
          reduce={!!reduce}
        />
      )}
      {!isBlocked && stage === "creating" && (
        <CreatingStage
          reduce={!!reduce}
          subStage={createSubStage}
          passkeyProgress={passkeyProgress}
        />
      )}
      {stage === "done" && (
        <DoneStage
          recoveryAddress={resultRecovery}
          txSignature={resultTxSig}
          onOpen={() => {
            if (!resultRecovery) return;
            router.push(`/app/secure/${encodeURIComponent(resultRecovery)}`);
          }}
          onBuildAnother={() => {
            setResultRecovery(null);
            setResultTxSig(null);
            setStage("shape");
          }}
          reduce={!!reduce}
        />
      )}
    </motion.div>
  );
}

// ─── Stage progress strip ─────────────────────────────────────────
//
// Three pill nodes connected by a thin rail. The active node is
// filled accent; past nodes carry a check; future nodes are dim.
// Folds the "creating" sub-stage into "Confirm" so the user sees a
// 3-step product flow, not 4.

const STRIP_STAGES: { id: Stage | "confirm-or-creating"; label: string }[] = [
  { id: "shape", label: "Shape" },
  { id: "confirm-or-creating", label: "Confirm" },
  { id: "done", label: "Done" },
];

function StageStrip({ stage }: { stage: Stage }) {
  const indexFor = (s: Stage) =>
    s === "shape" ? 0 : s === "done" ? 2 : 1; // confirm + creating both → 1
  const active = indexFor(stage);

  return (
    // `justify-center` centres the whole strip regardless of the
    // page's content width on both mobile and desktop. Each step
    // sits at its natural width with fixed-width connector rails
    // between, so the cluster reads as a tight, centred indicator
    // rather than a full-width stretch bar.
    <ol
      aria-label="Wizard progress"
      className="flex items-center justify-center gap-2 px-gutter sm:gap-3"
    >
      {STRIP_STAGES.map((s, i) => {
        const isActive = i === active;
        const isDone = i < active;
        return (
          <li
            key={s.id}
            className="flex items-center gap-2 sm:gap-3"
            aria-current={isActive ? "step" : undefined}
          >
            <span
              className={
                "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums " +
                (isActive
                  ? "bg-accent text-text-on-accent shadow-card-rest"
                  : isDone
                    ? "bg-accent/15 text-accent"
                    : "border border-border-soft bg-canvas text-text-soft")
              }
            >
              {isDone ? (
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
              ) : (
                i + 1
              )}
            </span>
            <span
              className={
                "hidden font-mono text-[10px] uppercase tracking-[0.2em] sm:inline-block " +
                (isActive || isDone ? "text-text-strong" : "text-text-soft")
              }
            >
              {s.label}
            </span>
            {/* Fixed-width connector rail between nodes. Mobile gets
                a shorter rail so the three nodes still fit on a
                ~360px viewport; sm+ gets a longer rail for breathing
                room. Past rails are accent, future are border. */}
            {i < STRIP_STAGES.length - 1 && (
              <span
                aria-hidden="true"
                className={
                  "h-px w-8 sm:w-14 " +
                  (i < active ? "bg-accent/60" : "bg-border-soft")
                }
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Stage 1 · Shape ─────────────────────────────────────────────

interface ShapeStageProps {
  shape: ThresholdShape;
  setShape: (s: ThresholdShape) => void;
  onContinue: () => void;
  reduce: boolean;
}

function ShapeStage({ shape, setShape, onContinue, reduce }: ShapeStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-7"
    >
      <header className="px-gutter text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Step 1 · Pick a shape
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong text-balance sm:mt-3">
          How many signers?
        </h1>
      </header>

      <ul className="flex flex-col gap-3 px-gutter">
        {SHAPES.map((s) => {
          const selected = s.id === shape.id;
          const Icon = s.id === "solo" ? User : Fingerprint;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setShape(s)}
                aria-pressed={selected}
                className={
                  "group relative block w-full overflow-hidden rounded-card border p-5 text-left sm:p-6 " +
                  "transition-[border-color,background-color,transform,box-shadow] duration-base ease-out-soft " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                  (selected
                    ? "border-accent bg-accent/[0.04] shadow-card-rest"
                    : "border-border-soft bg-surface-raised hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-raised")
                }
              >
                {/* Selected check badge - sits in the top-right
                    corner so the card itself can keep its full
                    typographic hierarchy. Lime ring + canvas
                    background reads as "this one is locked in". */}
                {selected && (
                  <span
                    aria-hidden="true"
                    className="absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-card-rest sm:right-5 sm:top-5"
                  >
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  </span>
                )}

                <div className="flex items-start gap-4">
                  <span
                    aria-hidden="true"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20"
                  >
                    <Icon className="h-5 w-5" strokeWidth={1.75} />
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col leading-tight">
                    <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft">
                      Threshold {s.threshold} of {s.members}
                    </p>
                    <p className="mt-1.5 font-display text-lg font-semibold tracking-[-0.015em] text-text-strong">
                      {s.label}
                    </p>
                    <p className="mt-2.5 max-w-md text-[13.5px] text-text-soft">
                      {s.blurb}
                    </p>

                    {/* Threshold dot pattern - sits under the body
                        copy, prefixed with a small label so it
                        reads as a spec line rather than a stray
                        graphic. */}
                    <div className="mt-4 inline-flex items-center gap-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
                        Quorum
                      </span>
                      <ThresholdDots
                        threshold={s.threshold}
                        members={s.members}
                        selected={selected}
                      />
                    </div>
                  </div>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      {/* Sticky-bottom CTA on mobile so the Continue button stays
          reachable after picking a shape on a long page. md+ keeps
          it in flow - the column is short there. */}
      <div
        className={
          "px-gutter " +
          "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
          "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
        }
      >
        <Button
          size="lg"
          fullWidth
          onClick={onContinue}
        >
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

function ThresholdDots({
  threshold,
  members,
  selected,
}: {
  threshold: number;
  members: number;
  selected: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex shrink-0 items-center gap-1.5"
    >
      {Array.from({ length: members }).map((_, i) => (
        <span
          key={i}
          className={
            "h-1.5 w-1.5 rounded-full transition-colors duration-base " +
            (i < threshold
              ? selected
                ? "bg-accent"
                : "bg-accent/70"
              : "bg-border-soft")
          }
        />
      ))}
    </span>
  );
}

// ─── Stage 2 · Confirm ───────────────────────────────────────────

interface ConfirmStageProps {
  shape: ThresholdShape;
  creatorAddress: string;
  onBack: () => void;
  onBuild: () => void;
  reduce: boolean;
}

function ConfirmStage({
  shape,
  creatorAddress,
  onBack,
  onBuild,
  reduce,
}: ConfirmStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const short = creatorAddress
    ? `${creatorAddress.slice(0, 4)}…${creatorAddress.slice(-4)}`
    : "";
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-7"
    >
      <header className="px-gutter text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Step 2 · Confirm
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong text-balance sm:mt-3">
          Build a {shape.threshold}-of-{shape.members} vault
        </h1>
      </header>

      {/* Receipt-style preview card. Header strip with vault
          identity + threshold pill, identity row, an at-a-glance
          quorum visualisation, and a clean key-value spec list. */}
      <article className="mx-gutter overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        <header className="flex items-center justify-between border-b border-border-soft px-5 py-3 sm:px-6">
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Vault summary
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent/10 px-2 py-0.5 font-numerals text-[11px] font-semibold tabular-nums text-accent">
            {shape.threshold}/{shape.members}
          </span>
        </header>

        <div className="px-5 py-5 sm:px-6 sm:py-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent/[0.08] text-accent ring-1 ring-accent/20">
              <VaultIcon className="h-5 w-5" strokeWidth={1.75} />
            </span>
            <div className="leading-tight">
              <p className="font-display text-base font-semibold tracking-[-0.01em] text-text-strong">
                {shape.label}
              </p>
              <p className="mt-0.5 text-[12px] text-text-soft">
                Solana key under quorum
              </p>
            </div>
          </div>

          {/* Quorum visualisation - mirrors the shape card so the
              user sees the same dots they tapped, now confirmed. */}
          <div className="mt-5 flex items-center gap-3 rounded-xl border border-border-soft bg-canvas px-3.5 py-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
              Quorum
            </span>
            <ThresholdDots
              threshold={shape.threshold}
              members={shape.members}
              selected
            />
            <span className="ml-auto font-numerals text-[12px] font-semibold tabular-nums text-text-strong">
              {shape.threshold} of {shape.members}
            </span>
          </div>

          {/* Spec list - eyebrow-style labels, value column right-
              aligned via flex-justify-between within each row. */}
          <ul className="mt-4 divide-y divide-border-soft border-y border-border-soft">
            <PreviewRow label="First signer" value={short} mono />
            <PreviewRow label="Curve" value="ed25519 (Solana)" />
            <PreviewRow label="Network" value="Solana devnet" />
          </ul>

        </div>
      </article>

      <div
        className={
          "flex flex-col gap-3 px-gutter " +
          "sticky bottom-[calc(env(safe-area-inset-bottom,0px)+4rem)] z-20 sm:static sm:bottom-auto " +
          "border-t border-border-soft bg-canvas pt-3 sm:border-0 sm:bg-transparent sm:pt-0"
        }
      >
        <Button size="lg" fullWidth onClick={onBuild}>
          Build vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="inline-flex w-full items-center justify-center text-sm text-text-soft transition-colors duration-base hover:text-text-strong"
        >
          Back to shape
        </button>
      </div>
    </motion.section>
  );
}

function PreviewRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <li className="flex items-baseline justify-between gap-3 py-2.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
        {label}
      </span>
      <span
        className={
          (mono ? "font-mono " : "font-display ") +
          "text-[13px] font-medium text-text-strong"
        }
      >
        {value}
      </span>
    </li>
  );
}

// ─── Stage 2.5 · Creating ────────────────────────────────────────
//
// Renders the engine's sub-stages as a checklist: completed steps
// show a check, the active step shows a spinner, future steps show
// a faint dot. Reads as a familiar "things-are-happening" surface
// instead of a single opaque spinner.

function CreatingStage({
  reduce,
  subStage,
  passkeyProgress,
}: {
  reduce: boolean;
  subStage: CreateVaultStage | null;
  passkeyProgress?: CreatePasskeyProgress | null;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };

  // Multi-member only: when the engine is in the `create-passkey`
  // stage, show "Passkey N of M" + which slot we're on. Single label
  // re-rendered as the index ticks; doesn't add a new stage row.
  const passkeyLabel =
    passkeyProgress != null
      ? `Creating passkey ${passkeyProgress.index} of ${passkeyProgress.total}`
      : "Creating passkeys";
  const STAGES: { id: CreateVaultStage; label: string }[] = [
    {
      id: "create-passkey",
      label: passkeyLabel,
    },
    {
      id: "dkg",
      label: "Running DKG",
    },
    {
      id: "wait-dwallet",
      label: "Activating dWallet",
    },
    {
      id: "build",
      label: "Building transaction",
    },
    {
      id: "sign",
      label: "Waiting for your signature",
    },
    {
      id: "submit",
      label: "Submitting on Solana",
    },
    {
      id: "confirm",
      label: "Waiting for confirmation",
    },
  ];
  const activeIdx = subStage ? STAGES.findIndex((s) => s.id === subStage) : 0;
  const activeStep = STAGES[activeIdx] ?? STAGES[0]!;

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-7 px-gutter"
    >
      <header className="text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Building your vault
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong text-balance sm:mt-3">
          {activeStep.label}
        </h1>
      </header>

      <ol className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-6">
        {STAGES.map((s, i) => {
          const isActive = i === activeIdx;
          const isDone = i < activeIdx;
          const isLast = i === STAGES.length - 1;
          return (
            <li
              key={s.id}
              aria-current={isActive ? "step" : undefined}
              className="relative flex items-start gap-3 pb-3 last:pb-0"
            >
              {/* Connector rail between dots. Past rails are accent
                  to show momentum; future rails fade. Sits behind
                  the dots so they punch through. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={
                    "absolute left-3 top-6 -z-0 h-[calc(100%-1rem)] w-px " +
                    (isDone ? "bg-accent/50" : "bg-border-soft")
                  }
                />
              )}
              <span
                className={
                  "relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ring-2 ring-surface-raised " +
                  (isDone
                    ? "bg-accent text-text-on-accent"
                    : isActive
                      ? "bg-accent/15 text-accent"
                      : "border border-border-soft bg-canvas text-text-soft")
                }
              >
                {isDone ? (
                  <Check className="h-3 w-3" strokeWidth={3} />
                ) : isActive ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="h-px w-3 rounded-full bg-text-soft/40"
                  />
                )}
              </span>
              <span
                className={
                  "min-h-6 self-center text-[13px] font-medium " +
                  (isActive
                    ? "text-text-strong"
                    : isDone
                      ? "text-text-soft"
                      : "text-text-soft/70")
                }
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </motion.section>
  );
}

// ─── Stage 3 · Done ──────────────────────────────────────────────

function DoneStage({
  recoveryAddress,
  txSignature,
  onOpen,
  onBuildAnother,
  reduce,
}: {
  recoveryAddress: string | null;
  txSignature: string | null;
  onOpen: () => void;
  onBuildAnother: () => void;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.4 }}
      className="flex flex-col gap-7 px-gutter"
    >
      <article className="relative overflow-hidden rounded-card border border-accent/40 bg-accent/[0.04] p-6 shadow-card-rest sm:p-8">
        {/* Soft top-right glow for the celebration. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-20 -top-20 h-48 w-48 rounded-full"
          style={{
            background:
              "radial-gradient(circle, var(--clear-accent-glow-rest) 0%, transparent 70%)",
            filter: "blur(40px)",
          }}
        />

        <div className="relative flex flex-col items-center text-center sm:flex-row sm:items-start sm:gap-5 sm:text-left">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-accent-rest">
            <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <div className="mt-4 sm:mt-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
              Vault is live
            </p>
            <h1 className="mt-2 font-display text-display-sm leading-[1.05] tracking-[-0.02em] text-text-strong">
              Your key is under quorum
            </h1>
          </div>
        </div>
      </article>

      {/* Result details - copyable recovery address + explorer link. */}
      {recoveryAddress && (
        <ResultRow
          label="Recovery address"
          value={recoveryAddress}
          copyable
        />
      )}
      {txSignature && (
        <a
          href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-accent transition-colors duration-base hover:text-accent-hover"
        >
          View transaction on Solana Explorer
          <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Button size="lg" fullWidth onClick={onOpen}>
          <VaultIcon className="h-4 w-4" aria-hidden="true" />
          Open vault
        </Button>
        <button
          type="button"
          onClick={onBuildAnother}
          className="inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-5 py-2.5 text-sm font-medium text-text-soft transition-colors duration-base hover:border-accent hover:text-accent sm:flex-1"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Build another
        </button>
      </div>
    </motion.section>
  );
}

function ResultRow({
  label,
  value,
  copyable,
}: {
  label: string;
  value: string;
  copyable?: boolean;
}) {
  const toast = useToast();
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied");
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <div className="flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
          {label}
        </span>
        <span className="mt-1 truncate font-mono text-[12px] text-text-strong">
          {value}
        </span>
      </div>
      {copyable && (
        <button
          type="button"
          onClick={onCopy}
          aria-label={`Copy ${label}`}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border-soft bg-canvas text-text-soft transition-colors duration-base hover:border-accent hover:text-accent"
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

// ─── Blocked screens ─────────────────────────────────────────────

function BlockedDisconnect() {
  return (
    <section className="mx-gutter rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest sm:p-8">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-8">
        <div className="text-center sm:text-left">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Sign in to continue
          </p>
          <h1 className="mt-2 font-display text-display-xs leading-tight tracking-[-0.02em] text-text-strong">
            Connect a wallet first
          </h1>
        </div>
        <Link href="/connect?next=/app/secure/new" className="inline-block">
          <Button size="lg">
            Sign in
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </section>
  );
}
