"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Check, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/retail/Button";
import { PageEyebrow } from "@/components/retail/PageEyebrow";
import { UsdHint } from "@/components/retail/UsdHint";
import type {
  SweepAuthMode,
  SweepStage as ActionStage,
} from "@/lib/ikavery/clearmsig-sweep";

export interface SplHolding {
  mint: string;
  amount: bigint;
  decimals: number;
  programId: string;
  /** Optional symbol derived from a small static list (USDC, USDT…). */
  symbol?: string;
}

export function formatTokenAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) return amount.toString();
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const frac = amount % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : whole.toString();
}

const LAMPORTS_PER_SOL = 1_000_000_000n;

interface RunStageInfo {
  id: ActionStage;
  label: string;
  detail: string;
}

const WALLET_RUN_STAGES: RunStageInfo[] = [
  {
    id: "build",
    label: "Preparing transfer",
    detail: "Checking the amount and destination.",
  },
  {
    id: "propose-approve-sign",
    label: "Approve transfer",
    detail: "Confirm in your wallet.",
  },
  {
    id: "propose-approve-confirm",
    label: "Saving approval",
    detail: "Recording your approval.",
  },
  {
    id: "execute-sign",
    label: "Approve release",
    detail: "Confirm the final release.",
  },
  {
    id: "execute-confirm",
    label: "Releasing funds",
    detail: "Confirming the release.",
  },
  {
    id: "presign-sign",
    label: "Securing transfer",
    detail: "Completing vault approval.",
  },
  {
    id: "broadcast",
    label: "Sending transfer",
    detail: "Sending funds to the destination.",
  },
  {
    id: "broadcast-confirm",
    label: "Waiting for confirmation",
    detail: "Confirming the funds moved.",
  },
];

const PASSKEY_RUN_STAGES: RunStageInfo[] = [
  {
    id: "build",
    label: "Building sweep",
    detail: "Encoding the SOL transfer + structural intent digest.",
  },
  {
    id: "propose-passkey",
    label: "Tap your passkey · propose",
    detail: "Authorising the proposal with a per-op WebAuthn assertion.",
  },
  {
    id: "propose-approve-sign",
    label: "Sign propose tx",
    detail: "Confirm in your wallet. Pays fees, doesn't authorise.",
  },
  {
    id: "propose-approve-confirm",
    label: "Submitting propose",
    detail: "Recording the proposal on Solana.",
  },
  {
    id: "approve-passkey",
    label: "Tap your passkey · approve",
    detail: "Same passkey signs the approval challenge.",
  },
  {
    id: "approve-sign",
    label: "Sign approve tx",
    detail: "Confirm in your wallet. Pays fees again.",
  },
  {
    id: "approve-confirm",
    label: "Submitting approve",
    detail: "Threshold reached on chain.",
  },
  {
    id: "execute-sign",
    label: "Approve release",
    detail: "Confirm the final release.",
  },
  {
    id: "execute-confirm",
    label: "Releasing funds",
    detail: "Confirming the release.",
  },
  {
    id: "presign-sign",
    label: "Securing transfer",
    detail: "Completing vault approval.",
  },
  {
    id: "broadcast",
    label: "Sending transfer",
    detail: "Sending funds to the destination.",
  },
  {
    id: "broadcast-confirm",
    label: "Waiting for confirmation",
    detail: "Confirming the funds moved.",
  },
];

interface ComposeStageProps {
  destination: string;
  setDestination: (v: string) => void;
  destinationError: string | null;
  amountInput: string;
  setAmountInput: (v: string) => void;
  amountError: string | null;
  dwalletPubkey: string | null;
  recoveryShort: string;
  loading: boolean;
  /** Live dWallet SOL balance in lamports. Used for "Max" + helper text. */
  balanceLamports: bigint | null;
  /** `null` = SOL; otherwise the picked SPL mint base58. */
  assetMint: string | null;
  setAssetMint: (m: string | null) => void;
  assetSymbol: string;
  decimals: number;
  holdings: SplHolding[] | null;
  holdingsLoading: boolean;
  selectedHolding: SplHolding | null;
  onMax: () => void;
  onContinue: () => void;
  reduce: boolean;
}

export function ComposeStage(props: ComposeStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const isSpl = props.assetMint !== null;
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
          Move {props.assetSymbol} from this vault to a destination address.
        </p>
      </PageEyebrow>

      <section className="mx-auto w-full max-w-md flex flex-col gap-4 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        {/* Asset picker. SOL is always available; SPL holdings appear
            when the dWallet owns any token accounts. */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sweep-asset"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Asset
          </label>
          <select
            id="sweep-asset"
            value={props.assetMint ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              props.setAssetMint(v ? v : null);
              props.setAmountInput("");
            }}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <option value="">
              SOL
              {props.balanceLamports != null
                ? ` · ${formatLamportsToSol(props.balanceLamports)} available`
                : ""}
            </option>
            {(props.holdings ?? []).map((h) => {
              const display = h.symbol ?? `${h.mint.slice(0, 4)}…${h.mint.slice(-4)}`;
              return (
                <option key={h.mint} value={h.mint}>
                  {display} · {formatTokenAmount(h.amount, h.decimals)} available
                </option>
              );
            })}
          </select>
          {props.holdingsLoading && (
            <p className="text-[10px] text-text-soft">Reading token balances…</p>
          )}
          {!props.holdingsLoading &&
            (props.holdings == null || props.holdings.length === 0) && (
              <p className="text-[10px] text-text-soft">
                No tokens detected yet. Only SOL.
              </p>
            )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="sweep-destination"
            className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
          >
            Destination address
          </label>
          <input
            id="sweep-destination"
            aria-label="Destination address"
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
          {isSpl && (
            <p className="text-[10px] text-text-soft">
              Sends to the recipient&rsquo;s wallet. We derive their{" "}
              {props.assetSymbol} ATA and create it on the fly if needed.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-end justify-between gap-2">
            <label
              htmlFor="sweep-amount"
              className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft"
            >
              Amount ({props.assetSymbol})
            </label>
            {!isSpl && props.balanceLamports != null && (
              <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                Balance: {formatLamportsToSol(props.balanceLamports)} SOL
                <UsdHint
                  amount={props.balanceLamports}
                  smallestPerWhole={1_000_000_000n}
                  ticker="SOL"
                />
              </span>
            )}
            {isSpl && props.selectedHolding && (
              <span className="font-numerals text-[10px] tabular-nums text-text-soft">
                Balance:{" "}
                {formatTokenAmount(
                  props.selectedHolding.amount,
                  props.selectedHolding.decimals,
                )}{" "}
                {props.assetSymbol}
                <UsdHint
                  amount={props.selectedHolding.amount}
                  smallestPerWhole={
                    10n ** BigInt(props.selectedHolding.decimals)
                  }
                  ticker={props.assetSymbol}
                />
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              id="sweep-amount"
              aria-label={`Amount in ${props.assetSymbol}`}
              type="text"
              inputMode="decimal"
              value={props.amountInput}
              onChange={(e) => props.setAmountInput(e.target.value)}
              placeholder="0.0"
              spellCheck={false}
              autoComplete="off"
              className="flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-numerals text-base tabular-nums text-text-strong placeholder:text-text-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            />
            <button
              type="button"
              onClick={props.onMax}
              disabled={
                isSpl ? !props.selectedHolding : props.balanceLamports == null
              }
              className={
                "shrink-0 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft " +
                "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              }
              title={
                isSpl
                  ? "Use full token balance"
                  : "Use max (balance minus fee reserve)"
              }
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
            {props.dwalletPubkey ?? "Vault backup needed"}
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
  amountDisplay: string;
  dwalletPubkey: string;
  messageBytesLen: number;
  isSpl: boolean;
  willCreateAta: boolean;
  authMode: SweepAuthMode;
  setAuthMode: (m: SweepAuthMode) => void;
  walletIsMember: boolean;
  vaultHasPasskey: boolean;
  onBack: () => void;
  onContinue: () => void;
  reduce: boolean;
}

export function ReviewStage(props: ReviewStageProps) {
  const motionProps = props.reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const showPicker = props.walletIsMember && props.vaultHasPasskey;
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
          <Row label="Amount" value={props.amountDisplay} mono={false} />
          <Row label="From" value={shortPub(props.dwalletPubkey)} title={props.dwalletPubkey} />
          <Row label="To" value={shortPub(props.destination)} title={props.destination} />
          <Row
            label="Message bytes"
            value={`${props.messageBytesLen} B`}
            mono={false}
          />
          {props.isSpl && (
            <Row
              label="Recipient ATA"
              value={
                props.willCreateAta
                  ? "May be created on the fly"
                  : "Derived from recipient + mint"
              }
              mono={false}
            />
          )}
        </dl>
      </section>

      {/* Auth picker. Only shown when both options are viable. If the
          connected wallet isn't on the roster (lost-wallet recovery),
          passkey is the only option and the picker hides. If the vault
          has no passkey members, wallet is the only option. */}
      {showPicker && (
        <section className="mx-auto w-full max-w-md flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Authorise as
          </p>
          <div className="grid grid-cols-2 gap-2">
            <AuthOption
              active={props.authMode === "wallet"}
              onClick={() => props.setAuthMode("wallet")}
              label="Wallet"
              detail="One-tap. Bundles propose + approve."
            />
            <AuthOption
              active={props.authMode === "passkey"}
              onClick={() => props.setAuthMode("passkey")}
              label="Passkey"
              detail="Two passkey taps. Lost-wallet recovery."
            />
          </div>
        </section>
      )}
      {!showPicker && props.authMode === "passkey" && (
        <p className="mx-auto max-w-md text-center text-[11px] text-text-soft">
          Connected wallet isn&rsquo;t on this vault&rsquo;s roster. Sweeping
          via enrolled passkey.
        </p>
      )}

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
      <span
        className={
          "text-sm font-semibold " +
          (active ? "text-accent" : "text-text-strong")
        }
      >
        {label}
      </span>
      <span className="text-[11px] text-text-soft">{detail}</span>
    </button>
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

interface CollectStateProps {
  count: number;
  threshold: number;
  busy: boolean;
  error: string | null;
  /** Disable the Wallet button when the connected wallet isn't on the roster.
   *  Avoids users tapping it and getting a delayed "not a member" error. */
  walletEnabled: boolean;
  onPick: (mode: SweepAuthMode) => void;
}

interface RunningStageProps {
  subStage: ActionStage | null;
  authMode: SweepAuthMode;
  reduce: boolean;
  collect: CollectStateProps | null;
}

export function RunningStage({
  subStage,
  authMode,
  reduce,
  collect,
}: RunningStageProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };
  const RUN_STAGES =
    authMode === "passkey" ? PASSKEY_RUN_STAGES : WALLET_RUN_STAGES;
  const activeIdx = subStage ? RUN_STAGES.findIndex((s) => s.id === subStage) : 0;
  const active = activeIdx >= 0 ? RUN_STAGES[activeIdx] : RUN_STAGES[0]!;
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-6 px-gutter py-16"
    >
      {/* When the action layer is paused waiting for additional
          approvals, show a credential picker instead of the spinner.
          The page has the live count + threshold; each click on a
          mode kicks off `addSweepApproval` and bumps the count. */}
      {collect ? (
        <>
          <div className="flex flex-col items-center gap-1 text-center">
            <p className="font-display text-xl font-semibold text-text-strong">
              {collect.count} of {collect.threshold} approvals
            </p>
            <p className="max-w-sm text-sm text-text-soft">
              The proposer&rsquo;s vote is in. Add the rest of the quorum
              by tapping a different credential for each.
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
                  : "Connected wallet isn't on this vault's roster"
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
              Approve as Wallet
              {!collect.walletEnabled && (
                <span className="font-mono text-[10px] text-text-soft">
                  (not on roster)
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
              Approve as Passkey
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
        </>
      )}
    </motion.section>
  );
}

interface DoneStageProps {
  amountDisplay: string;
  destination: string;
  proposeSig: string | null;
  executeSig: string | null;
  broadcastSig: string | null;
  recoveryStr: string;
  reduce: boolean;
}

export function DoneStage(props: DoneStageProps) {
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
          {props.amountDisplay} is on its way to{" "}
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

      <div className="mx-auto flex flex-col items-center gap-2">
        <Link
          href={`/app/secure/${encodeURIComponent(props.recoveryStr)}`}
          className="inline-flex"
        >
          <Button size="lg">
            Back to vault
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
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
 * "Max" button population. Both display contexts, never parsed back.
 */
export function formatLamportsToSol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = lamports % LAMPORTS_PER_SOL;
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  if (fracStr.length === 0) return whole.toString();
  // 4 decimals min so amounts like 0.05 don't render as "0.05" with a
  // truncated fractional tail that surprises a "Max"-then-edit user.
  const padded = fracStr.length >= 4 ? fracStr : fracStr.padEnd(4, "0");
  return `${whole}.${padded}`;
}
