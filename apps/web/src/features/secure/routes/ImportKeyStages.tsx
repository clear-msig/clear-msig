"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  KeyRound,
  Loader2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { UsdHint } from "@/components/retail/UsdHint";
import type { CreateVaultStage } from "@/lib/ikavery/clearmsig-actions";
import { maskAddress } from "@/lib/secure/import";
import { expectedCanonicalHost } from "@/lib/security/phishingGuard";

const LAMPORTS_PER_SOL = 1_000_000_000n;
const TX_FEE_RESERVE_LAMPORTS = 15_000n;

interface RunStageInfo {
  id: CreateVaultStage;
  label: string;
  detail: string;
}

const RUN_STAGES: RunStageInfo[] = [
  {
    id: "dkg",
    label: "Preparing vault",
    detail: "Creating the protected vault.",
  },
  {
    id: "wait-dwallet",
    label: "Waiting for confirmation",
    detail: "Confirming the vault on-chain.",
  },
  {
    id: "build",
    label: "Preparing transfer",
    detail: "Moving the funds into the new vault.",
  },
  {
    id: "sign",
    label: "Sign in your wallet",
    detail: "Approve once to continue.",
  },
  {
    id: "submit",
    label: "Finishing import",
    detail: "Saving the vault and moving funds.",
  },
  {
    id: "confirm",
    label: "Finalising",
    detail: "Funds are moving into the protected vault.",
  },
];

interface IntroStageProps {
  onContinue: () => void;
  walletConnected: boolean;
  secureContext: boolean | null;
  reduce: boolean;
}

export function IntroStage({
  onContinue,
  walletConnected,
  secureContext,
  reduce,
}: IntroStageProps) {
  const expectedHost = expectedCanonicalHost();
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const blocked = !walletConnected || secureContext === false;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · import" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <KeyRound className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Move funds into your vault
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Paste the old wallet key, choose an amount, and sign once. ClearSig
          moves the SOL into a fresh protected vault.
        </p>
      </PageEyebrow>

      <ul className="mx-auto flex w-full max-w-md flex-col gap-2">
        <FeatureRow
          Icon={ShieldCheck}
          title="Key stays local"
          body="Never sent to ClearSig."
        />
        <FeatureRow
          Icon={Sparkles}
          title="One transaction"
          body="If it fails, funds stay put."
        />
        <FeatureRow
          Icon={KeyRound}
          title="Wiped after use"
          body="Cleared after the move."
        />
      </ul>

      <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
        <ShieldAlert
          className="mt-0.5 h-5 w-5 shrink-0 text-warning"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-snug">
          <span className="font-medium text-text-strong">
            Anyone with this key drains the wallet.
          </span>{" "}
          Check the URL is{" "}
          <span className="font-mono text-[11px] text-text-strong">
            {expectedHost}
          </span>{" "}
          before you paste.
        </p>
      </aside>

      {!walletConnected && (
        <BlockedNote
          title="Connect a wallet first"
          body="The new vault needs an owner. Your connected Solana wallet becomes member 0 and pays the tx fee."
          ctaHref="/connect?next=/app/secure/import"
          ctaLabel="Sign in"
        />
      )}
      {secureContext === false && (
        <BlockedNote
          title="HTTPS required"
          body="We refuse to ask for a secret key over plain HTTP. Reload the page over https:// or localhost."
        />
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={onContinue} disabled={blocked}>
          Continue
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface ComposeStageProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onChange: () => void;
  derivedAddress: string | null;
  parseError: string | null;
  parseFormat: "base58" | "json" | null;
  isSelfImport: boolean;
  balanceLamports: bigint | null;
  balanceLoading: boolean;
  amountSol: string;
  setAmountSol: (v: string) => void;
  amountError: string | null;
  onMax: () => void;
  onContinue: () => void;
  onBack: () => void;
  reduce: boolean;
}

export function ComposeStage(props: ComposeStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · import" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Paste your secret key
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          Phantom / Solflare export format (base58) or{" "}
          <span className="font-mono text-[12px] text-text-strong">solana-keygen</span>{" "}
          JSON array. We never persist or transmit it.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="secret-key"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Secret key
          </label>
          {/* Uncontrolled <input type="password">. The secret never
              enters React state, and `password` is masked across every
              browser (textarea + CSS `text-security:disc` only works
              on WebKit/Blink). Long base58 strings overflow-x naturally;
              JSON arrays still parse because JSON.parse is whitespace
              tolerant.
              No "Show" toggle by design. Verifying via the derived
              address (rendered below on parse) is safer than echoing
              the secret onto the user's screen. */}
          <input
            id="secret-key"
            aria-label="Secret key"
            ref={props.inputRef}
            type="password"
            onChange={props.onChange}
            onPaste={props.onChange}
            placeholder="Paste base58 (Phantom / Solflare) or [1,2,3,…,64] JSON"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            data-1p-ignore
            data-lpignore="true"
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-sm text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
          {props.parseError && (
            <p className="text-[11px] text-warning">{props.parseError}</p>
          )}
          {props.derivedAddress && (
            <div className="mt-2 flex flex-col gap-1.5 rounded-soft border border-accent/30 bg-accent/[0.04] p-3 text-[11px] text-text-soft">
              <span className="inline-flex items-center gap-1.5 font-medium text-accent">
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                Verified · {props.parseFormat === "json" ? "JSON" : "base58"}
              </span>
              <span>
                Derived address:{" "}
                <span className="font-mono text-text-strong">
                  {maskAddress(props.derivedAddress)}
                </span>
              </span>
              <span className="font-numerals tabular-nums">
                Balance:{" "}
                {props.balanceLoading
                  ? "checking…"
                  : props.balanceLamports != null
                    ? `${formatLamportsToSol(props.balanceLamports)} SOL`
                    : "unknown"}
                {props.balanceLamports != null && (
                  <UsdHint
                    amount={props.balanceLamports}
                    smallestPerWhole={1_000_000_000n}
                    ticker="SOL"
                  />
                )}
              </span>
            </div>
          )}
          {props.isSelfImport && (
            <p className="text-[11px] text-warning">
              That key matches your connected wallet. Use{" "}
              <Link href="/app/secure/new" className="underline">
                Build a vault
              </Link>{" "}
              instead. There&rsquo;s nothing to import to itself.
            </p>
          )}
        </div>

        {props.derivedAddress && !props.isSelfImport && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-end justify-between gap-2">
              <label
                htmlFor="amount-sol"
                className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
              >
                Amount (SOL)
              </label>
              {props.balanceLamports != null && (
                <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                  Balance: {formatLamportsToSol(props.balanceLamports)} SOL
                  <UsdHint
                    amount={props.balanceLamports}
                    smallestPerWhole={1_000_000_000n}
                    ticker="SOL"
                  />
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <input
                id="amount-sol"
                aria-label="Amount in SOL"
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
                title="Move the full imported balance"
              >
                Max
              </button>
            </div>
            {props.amountError && (
              <p className="text-[11px] text-warning">{props.amountError}</p>
            )}
            <p className="text-[10px] text-text-soft">
              Tx fees ({Number(TX_FEE_RESERVE_LAMPORTS) / 1e9} SOL) are paid
              by your connected wallet, not the imported key.
            </p>
          </div>
        )}
      </section>

      <div className="mx-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="lg"
          onClick={props.onBack}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button
          size="lg"
          onClick={props.onContinue}
          disabled={!props.derivedAddress || props.isSelfImport}
        >
          Review
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface ReviewStageProps {
  fromAddress: string;
  toLabel: string;
  amountSol: string;
  balanceLamports: bigint | null;
  lamports: bigint | null;
  onBack: () => void;
  onConfirm: () => void;
  reduce: boolean;
}

export function ReviewStage(props: ReviewStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const remainingSol =
    props.balanceLamports != null && props.lamports != null
      ? formatLamportsToSol(props.balanceLamports - props.lamports)
      : null;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-6"
    >
      <PageEyebrow label="// 02 · import" align="center">
        <h1 className="font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Confirm the import
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          One Solana tx, three signatures (you, recovery_id, and the
          imported key. Locally). Atomic.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <dl className="flex flex-col gap-3">
          <Row label="From" value={maskAddress(props.fromAddress)} title={props.fromAddress} />
          <Row label="To" value={props.toLabel} mono={false} />
          <Row label="Amount" value={`${props.amountSol} SOL`} mono={false} />
          {remainingSol != null && (
            <Row
              label="Imported wallet remaining"
              value={`${remainingSol} SOL`}
              mono={false}
            />
          )}
        </dl>
      </section>

      <aside className="mx-auto flex max-w-md items-start gap-3 rounded-card border border-border-soft bg-canvas p-4 text-[11px] text-text-soft">
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0 text-text-soft"
          strokeWidth={2}
          aria-hidden="true"
        />
        <p className="leading-snug">
          After confirm, we&rsquo;ll wipe the imported key from memory. The
          imported address will show this one final outgoing transaction;
          everything after happens through the new vault.
        </p>
      </aside>

      <div className="mx-auto flex items-center gap-2">
        <Button
          variant="ghost"
          size="lg"
          onClick={props.onBack}
          aria-label="Back"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back
        </Button>
        <Button size="lg" onClick={props.onConfirm}>
          Import + create vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

interface CreatingStageProps {
  subStage: CreateVaultStage | null;
  reduce: boolean;
}

export function CreatingStage({ subStage, reduce }: CreatingStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const activeIdx = subStage
    ? RUN_STAGES.findIndex((s) => s.id === subStage)
    : 0;
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
          {active?.label ?? "Importing…"}
        </p>
        <p className="max-w-sm text-sm text-text-soft">
          {active?.detail ?? "Bundling the atomic import tx."}
        </p>
      </div>
      <ol className="flex items-center gap-1.5" aria-label="import progress">
        {RUN_STAGES.map((s, i) => {
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
    </motion.section>
  );
}

interface DoneStageProps {
  recoveryAddress: string | null;
  txSignature: string | null;
  amountSol: string;
  onOpen: () => void;
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
      <PageEyebrow label="// 02 · import" align="center">
        <span className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Check className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        </span>
        <h1 className="mt-3 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          Funds protected
        </h1>
        <p className="mx-auto mt-2 max-w-md text-base text-text-soft">
          {props.amountSol} SOL is now under quorum protection. The imported
          key has been wiped from memory; future moves go through the vault.
        </p>
      </PageEyebrow>

      {props.txSignature && (
        <a
          href={`https://explorer.solana.com/tx/${props.txSignature}?cluster=devnet`}
          target="_blank"
          rel="noreferrer"
          className="mx-auto inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft hover:border-accent hover:text-accent"
        >
          View on Solana Explorer
        </a>
      )}

      <div className="mx-auto flex flex-col items-center gap-2">
        <Button size="lg" onClick={props.onOpen}>
          Open vault
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </motion.section>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────

function FeatureRow({
  Icon,
  title,
  body,
}: {
  Icon: typeof KeyRound;
  title: string;
  body: string;
}) {
  return (
    <li className="flex items-start gap-3 rounded-card border border-border-soft bg-surface-raised p-4">
      <Icon
        className="mt-0.5 h-5 w-5 shrink-0 text-accent"
        strokeWidth={1.75}
        aria-hidden="true"
      />
      <span className="text-sm text-text-soft">
        <span className="font-medium text-text-strong">{title}.</span> {body}
      </span>
    </li>
  );
}

function BlockedNote({
  title,
  body,
  ctaHref,
  ctaLabel,
}: {
  title: string;
  body: string;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  return (
    <aside className="mx-auto flex max-w-md flex-col gap-2 rounded-card border border-warning/40 bg-warning/[0.06] p-4 text-sm text-text-soft">
      <p className="font-medium text-text-strong">{title}</p>
      <p>{body}</p>
      {ctaHref && ctaLabel && (
        <Link href={ctaHref} className="self-start">
          <Button size="sm">
            {ctaLabel}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </Link>
      )}
    </aside>
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
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {label}
      </dt>
      <dd
        className={
          "text-right text-sm text-text-strong " +
          (mono ? "font-mono" : "")
        }
        title={title}
      >
        {value}
      </dd>
    </div>
  );
}

export function formatLamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}
