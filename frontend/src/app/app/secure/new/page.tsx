"use client";

// /app/secure/new — wizard for creating a new ikavery vault.
// (Route is /new, not /build, because the frontend's .gitignore
// has `build/` from a Next.js convention and would have hidden the
// file. Naming matches /app/wallet/[name]/policies/new.)
//
// Three stages, mirroring the existing /welcome create-wallet wizard:
//   1. shape  — pick a threshold preset (just-me / 2-of-3 / 3-of-5).
//                The first version only ships threshold=1 (solo). The
//                multi-member presets are visible but disabled with
//                "add devices later" copy because real device
//                enrollment is the v3 lift.
//   2. confirm — preview card showing what we're about to sign and
//                the "Build vault" CTA.
//   3. done    — success state + "Open vault" / "Build another".
//
// One signed write: the create_recovery instruction. Two signers in
// the tx — the user's connected wallet (creator + payer) and a
// throwaway recoveryId keypair (PDA seed). The throwaway is generated
// client-side and never referenced again.
//
// Why solo only at v2: real multi-member vaults need passkey or
// secondary wallet enrollment to bind member 1+. That requires the
// /app/secure/[recovery]/devices flow which lands in v3.

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Fingerprint,
  Loader2,
  ShieldCheck,
  User,
  Vault as VaultIcon,
} from "lucide-react";
import { useConnection, useWallet } from "@/lib/wallet";
import { Button } from "@/components/retail/Button";
import { BackToWallets } from "@/components/retail/BackToWallets";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { useToast } from "@/components/ui/Toast";
import { createSoloVault } from "@/lib/ikavery/clearmsig-actions";

type Stage = "shape" | "confirm" | "creating" | "done";

interface ThresholdShape {
  id: "solo" | "2of3" | "3of5";
  label: string;
  threshold: number;
  members: number;
  blurb: string;
  /** When true, available in v2. Otherwise stub. */
  available: boolean;
}

const SHAPES: ThresholdShape[] = [
  {
    id: "solo",
    label: "Just me",
    threshold: 1,
    members: 1,
    blurb:
      "Your connected wallet is the only signer. Add devices later — your vault, your decision.",
    available: true,
  },
  {
    id: "2of3",
    label: "2 of 3",
    threshold: 2,
    members: 3,
    blurb:
      "You + two devices. Any two sign and you're in. Tolerates losing one device.",
    available: false,
  },
  {
    id: "3of5",
    label: "3 of 5",
    threshold: 3,
    members: 5,
    blurb:
      "Default Ikavery shape. Five devices, three to recover. Tolerates losing two.",
    available: false,
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

  const [stage, setStage] = useState<Stage>("shape");
  const [shape, setShape] = useState<ThresholdShape>(SHAPES[0]!);
  const [resultRecovery, setResultRecovery] = useState<string | null>(null);
  const [resultTxSig, setResultTxSig] = useState<string | null>(null);

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
    if (!shape.available) {
      toast.info("Coming soon", {
        details: "Multi-device vaults land with the device-enrollment flow in v3.",
      });
      return;
    }
    setStage("confirm");
  };

  const handleBuild = async () => {
    if (!wallet.connected || !wallet.publicKey || !wallet.signTransaction) {
      toast.error("Connect a wallet first");
      return;
    }
    if (wallet.isLedger) {
      toast.error("Ledger not supported yet", {
        details:
          "Ledger transaction signing for the vault flow is on the v3 list. Use your Dynamic wallet for now.",
      });
      return;
    }
    setStage("creating");
    try {
      const result = await createSoloVault({
        connection,
        creator: wallet.publicKey,
        threshold: shape.threshold,
        signTransaction: wallet.signTransaction,
      });
      setResultRecovery(result.recovery.toBase58());
      setResultTxSig(result.txSignature);
      setStage("done");
    } catch (e) {
      console.error("[secure/build]", e);
      toast.error("Couldn't build the vault", {
        details: e instanceof Error ? e.message : String(e),
      });
      setStage("confirm");
    }
  };

  return (
    <motion.div {...fadeIn(0)} className="flex flex-col gap-8">
      <div className="px-gutter md:hidden">
        <BackToWallets label="Wallets" />
      </div>

      {stage !== "done" && (
        <div className="px-gutter">
          <Link
            href="/app/secure"
            className="inline-flex items-center gap-1.5 text-xs text-text-soft hover:text-text-strong"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden="true" />
            Back to Secure
          </Link>
        </div>
      )}

      {stage === "shape" && (
        <ShapeStage
          shape={shape}
          setShape={setShape}
          onContinue={handleConfirm}
          reduce={!!reduce}
        />
      )}
      {stage === "confirm" && (
        <ConfirmStage
          shape={shape}
          creatorAddress={wallet.publicKey?.toBase58() ?? ""}
          onBack={() => setStage("shape")}
          onBuild={handleBuild}
          reduce={!!reduce}
        />
      )}
      {stage === "creating" && <CreatingStage reduce={!!reduce} />}
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
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 01 · pick a shape" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          How many signers?
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          The threshold is how many signers must agree before the vault
          releases the key. Pick the one that fits your situation.
        </p>
      </PageEyebrow>

      <ul className="flex flex-col gap-2">
        {SHAPES.map((s) => {
          const selected = s.id === shape.id;
          const disabled = !s.available;
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setShape(s)}
                className={
                  "flex w-full items-start gap-3 rounded-card border p-4 text-left " +
                  "transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                  (selected
                    ? "border-accent bg-accent/[0.05] shadow-card-rest"
                    : disabled
                      ? "cursor-not-allowed border-border-soft bg-surface-raised/60 opacity-60"
                      : "border-border-soft bg-surface-raised hover:-translate-y-0.5 hover:border-accent/40")
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-full " +
                    (selected
                      ? "bg-accent text-white"
                      : "bg-accent/10 text-accent")
                  }
                >
                  {s.id === "solo" ? (
                    <User className="h-4 w-4" strokeWidth={1.75} />
                  ) : (
                    <Fingerprint className="h-4 w-4" strokeWidth={1.75} />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="font-display text-base font-semibold text-text-strong">
                      {s.label}
                    </span>
                    {disabled && (
                      <span className="rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-soft">
                        v3
                      </span>
                    )}
                  </span>
                  <span className="font-numerals text-[11px] tabular-nums text-text-soft">
                    threshold {s.threshold} of {s.members}
                  </span>
                  <span className="mt-1 text-sm text-text-soft text-pretty">
                    {s.blurb}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex justify-center">
        <Button size="lg" onClick={onContinue} disabled={!shape.available}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

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
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · confirm" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Build a {shape.threshold}-of-{shape.members} vault
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Your wallet will be asked to sign the transaction that creates
          the vault on chain.
        </p>
      </PageEyebrow>

      <ul className="flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <PreviewRow label="Threshold" value={`${shape.threshold} of ${shape.members}`} mono />
        <PreviewRow label="First signer" value={short} mono />
        <PreviewRow label="Curve" value="ed25519 (Solana)" />
        <PreviewRow label="Network" value="Solana devnet" />
      </ul>

      <div className="flex flex-col items-center gap-3">
        <Button size="lg" onClick={onBuild}>
          Build vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="text-sm text-text-soft hover:text-text-strong"
        >
          Back
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
    <li className="flex items-baseline justify-between gap-3 border-b border-border-soft py-2 last:border-0">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {label}
      </span>
      <span
        className={
          (mono ? "font-mono " : "font-display ") +
          "text-sm text-text-strong"
        }
      >
        {value}
      </span>
    </li>
  );
}

function CreatingStage({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0 }, animate: { opacity: 1 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-4 py-16 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Loader2 className="h-6 w-6 animate-spin" aria-hidden="true" />
      </div>
      <p className="font-display text-display-xs text-text-strong">
        Building your vault
      </p>
      <p className="max-w-md text-sm text-text-soft">
        Sign the transaction in your wallet. The vault is created on chain
        in one step.
      </p>
    </motion.section>
  );
}

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
      className="flex flex-col items-center gap-6 text-center"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-accent text-white shadow-accent-rest">
        <Check className="h-8 w-8" strokeWidth={2.5} aria-hidden="true" />
      </div>
      <PageEyebrow label="// 03 · done" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
          Vault is live
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Your key is now under threshold custody. Open it to add devices
          or set up a sweep destination.
        </p>
      </PageEyebrow>

      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button size="lg" onClick={onOpen}>
          <VaultIcon className="h-4 w-4" aria-hidden="true" />
          Open vault
        </Button>
        <button
          type="button"
          onClick={onBuildAnother}
          className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-4 py-2 text-sm font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
          Build another
        </button>
      </div>

      {(recoveryAddress || txSignature) && (
        <ul className="mt-2 flex flex-col gap-1 text-[11px] text-text-soft">
          {recoveryAddress && (
            <li>
              <span className="text-text-soft">Recovery:</span>{" "}
              <span className="font-mono text-text-strong">
                {recoveryAddress}
              </span>
            </li>
          )}
          {txSignature && (
            <li>
              <a
                href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
                target="_blank"
                rel="noreferrer"
                className="text-accent hover:text-accent-hover"
              >
                View tx on Solana Explorer →
              </a>
            </li>
          )}
        </ul>
      )}
    </motion.section>
  );
}
