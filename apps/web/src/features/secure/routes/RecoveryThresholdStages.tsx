"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, Fingerprint, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import type { BumpAuthMode, BumpThresholdStage } from "@/lib/ikavery/clearmsig-roster";

const WALLET_RUN_STAGES: {
  id: BumpThresholdStage;
  label: string;
  detail: string;
}[] = [
  {
    id: "stage-sign",
    label: "Confirm change",
    detail: "Your wallet starts the protection change.",
  },
  {
    id: "stage-confirm",
    label: "Saving",
    detail: "Recording the change request.",
  },
  {
    id: "sign",
    label: "Confirm again",
    detail: "Your wallet reviews the new protection level.",
  },
  {
    id: "submit",
    label: "Submitting",
    detail: "Sending the protection request.",
  },
  {
    id: "confirm",
    label: "Confirming",
    detail: "Waiting for the request to settle.",
  },
  {
    id: "approve-sign",
    label: "Approve",
    detail: "Your wallet adds your approval.",
  },
  {
    id: "approve-submit",
    label: "Saving approval",
    detail: "Recording your approval.",
  },
  {
    id: "approve-confirm",
    label: "Confirming approval",
    detail: "Waiting for your approval to settle.",
  },
  {
    id: "collecting-approvals",
    label: "Collecting extra approvals",
    detail: "Ask another trusted device or member to approve.",
  },
  {
    id: "execute-sign",
    label: "Finish change",
    detail: "Your wallet applies the new protection level.",
  },
  {
    id: "execute-confirm",
    label: "Finalising",
    detail: "Saving the new protection level.",
  },
];

const PASSKEY_RUN_STAGES: {
  id: BumpThresholdStage;
  label: string;
  detail: string;
}[] = [
  {
    id: "stage-sign",
    label: "Confirm change",
    detail: "Your wallet starts the protection change.",
  },
  {
    id: "stage-confirm",
    label: "Saving",
    detail: "Recording the change request.",
  },
  {
    id: "propose-passkey",
    label: "Tap passkey",
    detail: "Approve the protection change.",
  },
  {
    id: "sign",
    label: "Confirm in wallet",
    detail: "Your wallet reviews the request.",
  },
  {
    id: "submit",
    label: "Submitting",
    detail: "Sending the protection request.",
  },
  {
    id: "confirm",
    label: "Confirming",
    detail: "Waiting for the request to settle.",
  },
  {
    id: "approve-passkey",
    label: "Tap your passkey · approve",
    detail: "Authorise the approve challenge.",
  },
  {
    id: "approve-sign",
    label: "Confirm approval",
    detail: "Your wallet records the approval.",
  },
  {
    id: "approve-submit",
    label: "Saving approval",
    detail: "Recording the approval.",
  },
  {
    id: "approve-confirm",
    label: "Confirming approval",
    detail: "Waiting for the approval to settle.",
  },
  {
    id: "collecting-approvals",
    label: "Collecting extra approvals",
    detail: "Ask another trusted device or member to approve.",
  },
  {
    id: "execute-sign",
    label: "Finish change",
    detail: "Your wallet applies the new protection level.",
  },
  {
    id: "execute-confirm",
    label: "Finalising",
    detail: "Saving the new protection level.",
  },
];

interface IntroStageProps {
  currentThreshold: number;
  memberCount: number;
  newThreshold: number;
  setNewThreshold: (n: number) => void;
  minNew: number;
  maxNew: number;
  recoveryShort: string;
  authMode: BumpAuthMode;
  setAuthMode: (m: BumpAuthMode) => void;
  walletIsMember: boolean;
  vaultHasPasskey: boolean;
  webauthnState:
    | null
    | { ok: true }
    | { ok: false; reason: "insecure" | "unavailable" };
  onContinue: () => void;
  reduce: boolean;
}

export function IntroStage({
  currentThreshold,
  memberCount,
  newThreshold,
  setNewThreshold,
  minNew,
  maxNew,
  recoveryShort,
  authMode,
  setAuthMode,
  walletIsMember,
  vaultHasPasskey,
  webauthnState,
  onContinue,
  reduce,
}: IntroStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const options: number[] = [];
  for (let i = minNew; i <= maxNew; i++) options.push(i);
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 06 · roster" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Lock down vault {recoveryShort}
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Choose how many trusted approvals are needed before funds can move.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
          New protection
        </p>
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {options.map((n) => (
            <li key={n}>
              <button
                type="button"
                onClick={() => setNewThreshold(n)}
                aria-pressed={n === newThreshold}
                className={
                  "w-full min-h-tap rounded-soft border bg-canvas px-3 py-2 font-numerals text-base font-semibold tabular-nums " +
                  "transition-[border-color,background-color,color] duration-base ease-out-soft " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
                  (n === newThreshold
                    ? "border-accent bg-accent/[0.06] text-accent"
                    : "border-border-soft text-text-strong hover:border-accent/40")
                }
              >
                {n}
                <span className="font-display text-[10px] font-medium tracking-normal text-text-soft">
                  {" of "}
                  {memberCount}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <div className="rounded-soft border border-border-soft bg-canvas p-3 text-[11px] text-text-soft">
          <span className="font-medium text-text-strong">
            {currentThreshold} → {newThreshold}.
          </span>{" "}
          {currentThreshold === 1
            ? "Today any device can sweep solo. After the change, "
            : ""}
          {newThreshold} of {memberCount} approvals will be required for
          recovery actions.
        </div>
      </section>

      {/* Auth picker. Shown only when both options are viable. If
          the wallet isn't a roster member but the vault has a passkey,
          we silently use passkey. If only wallet is viable, no picker. */}
      {walletIsMember && vaultHasPasskey && (
        <section className="mx-auto w-full max-w-md flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Authorise as
          </p>
          <div className="grid grid-cols-2 gap-2">
            <AuthOption
              active={authMode === "wallet"}
              onClick={() => setAuthMode("wallet")}
              label="Wallet"
              detail="Use the connected wallet."
            />
            <AuthOption
              active={authMode === "passkey"}
              onClick={() => setAuthMode("passkey")}
              label="Existing passkey"
              detail="Use a trusted passkey."
            />
          </div>
        </section>
      )}
      {!walletIsMember && authMode === "passkey" && (
        <p className="mx-auto max-w-md text-center text-[11px] text-text-soft">
          Connected wallet isn&rsquo;t on this vault&rsquo;s roster. Bumping
          via an existing passkey.
        </p>
      )}

      {/* Pre-flight WebAuthn warning, only relevant in passkey mode. */}
      {authMode === "passkey" && webauthnState && !webauthnState.ok && (
        <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
          <ShieldCheck
            className="mt-0.5 h-5 w-5 shrink-0 text-warning"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="leading-snug">
            <span className="font-medium text-text-strong">
              Passkeys aren&rsquo;t available here.
            </span>{" "}
            {webauthnState.reason === "insecure"
              ? "Passkeys need a secure browser tab. Reload over https:// or localhost and try again."
              : "Passkeys are not available in this browser. Try Chrome, Safari, or Edge in a normal tab."}
          </p>
        </aside>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button
          size="lg"
          onClick={onContinue}
          disabled={authMode === "passkey" && webauthnState?.ok === false}
        >
          {authMode === "passkey" ? (
            <>
              <Fingerprint className="h-4 w-4" aria-hidden="true" />
              Lock to {newThreshold} of {memberCount}
            </>
          ) : (
            <>
              Lock to {newThreshold} of {memberCount}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </>
          )}
        </Button>
        <p className="text-[11px] text-text-soft">
          {authMode === "passkey"
            ? "ClearSig will ask for the passkey and wallet confirmations it needs."
            : "ClearSig will ask for each confirmation as the protection changes."}
        </p>
      </div>
    </motion.section>
  );
}

function AuthOption({
  active,
  onClick,
  label,
  detail,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  detail: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "flex flex-col items-start gap-1 rounded-soft border bg-canvas px-3 py-3 text-left " +
        "transition-[border-color,background-color] duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent " +
        (active
          ? "border-accent bg-accent/[0.05]"
          : "border-border-soft hover:border-accent/40")
      }
    >
      <span className="font-display text-sm font-semibold text-text-strong">
        {label}
      </span>
      <span className="text-[11px] text-text-soft">{detail}</span>
    </button>
  );
}

interface CollectStateProps {
  count: number;
  threshold: number;
  busy: boolean;
  error: string | null;
  walletEnabled: boolean;
  onPick: (mode: BumpAuthMode) => void;
}

interface RunningStageProps {
  subStage: BumpThresholdStage | null;
  authMode: BumpAuthMode;
  reduce: boolean;
  collect: CollectStateProps | null;
}

export function RunningStage({ subStage, authMode, reduce, collect }: RunningStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const stages =
    authMode === "passkey" ? PASSKEY_RUN_STAGES : WALLET_RUN_STAGES;
  const activeIdx = subStage ? stages.findIndex((s) => s.id === subStage) : 0;
  const active = activeIdx >= 0 ? stages[activeIdx] : stages[0]!;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      {collect ? (
        <>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="font-display text-xl font-semibold text-text-strong">
              {collect.count} of {collect.threshold} approvals
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              One approval is in. Use a different trusted device or member
              for each remaining approval.
            </p>
          </div>
          <div className="flex w-full max-w-md flex-col gap-2">
            <button
              type="button"
              onClick={() => collect.onPick("wallet")}
              disabled={collect.busy || !collect.walletEnabled}
              title={
                collect.walletEnabled
                  ? undefined
                  : "The connected wallet already approved"
              }
              className={
                "flex w-full min-h-tap items-center justify-center gap-2 rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm font-medium text-text-strong shadow-card-rest " +
                "transition-[border-color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent/40 " +
                "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:border-border-soft " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              {collect.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Approve with wallet
              {!collect.walletEnabled && (
                <span className="font-mono text-[10px] text-text-soft">
                  (already used)
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => collect.onPick("passkey")}
              disabled={collect.busy}
              className={
                "flex w-full min-h-tap items-center justify-center gap-2 rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-sm font-medium text-text-strong shadow-card-rest " +
                "transition-[border-color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent/40 " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              {collect.busy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Approve with passkey
            </button>
          </div>
          {collect.error && (
            <p className="max-w-md text-center text-[11px] text-warning">
              {collect.error}
            </p>
          )}
        </>
      ) : (
        <>
          <Loader2
            className="h-10 w-10 animate-spin text-accent"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="font-display text-xl font-semibold text-text-strong">
              {active?.label ?? "Bumping…"}
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              {active?.detail ?? "Saving the protection change."}
            </p>
          </div>
          <ol className="flex items-center gap-1.5" aria-label="bump progress">
            {stages.map((s, i) => {
              const completed = activeIdx > i;
              const current = activeIdx === i;
              return (
                <li
                  key={s.id}
                  aria-label={s.label}
                  className={
                    "h-1.5 w-8 rounded-full " +
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
        </>
      )}
    </motion.section>
  );
}

interface DoneStageProps {
  newThreshold: number;
  memberCount: number;
  txSig: string | null;
  onContinue: () => void;
  reduce: boolean;
}

export function DoneStage(props: DoneStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="Protection" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Locked down
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Vault is now{" "}
          <span className="font-numerals tabular-nums text-text-strong">
            {props.newThreshold}
          </span>{" "}
          of{" "}
          <span className="font-numerals tabular-nums text-text-strong">
            {props.memberCount}
          </span>
          . Recovery actions now need that many approvals.
        </p>
      </PageEyebrow>

      {props.txSig && (
        <a
          href={`https://explorer.solana.com/tx/${props.txSig}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mx-auto inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          View on Solana Explorer
        </a>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={props.onContinue}>
          Back to vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

export function BlockedNote({
  eyebrow,
  title,
  body,
  cta,
}: {
  eyebrow: string;
  title: string;
  body: string;
  cta?: { href: string; label: string };
}) {
  return (
    <PageEyebrow label={eyebrow} align="center">
      <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ShieldCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong">
        {title}
      </h1>
      <p className="mx-auto mt-2 max-w-md text-base text-text-soft">{body}</p>
      {cta && (
        <Link href={cta.href} className="mt-5 inline-flex">
          <Button size="lg">
            {cta.label}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      )}
    </PageEyebrow>
  );
}
