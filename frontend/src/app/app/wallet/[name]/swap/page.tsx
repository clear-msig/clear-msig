"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Clock,
  LockKeyhole,
  Repeat2,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { SendAmountField } from "@/components/retail/SendAmountField";
import { toDisplayName } from "@/lib/retail/walletNames";
import { formatUsd } from "@/lib/retail/priceConversion";
import {
  SWAP_ASSETS,
  listSwapDrafts,
  quoteIsExecutable,
  storeSwapDraft,
  swapAsset,
  type SwapAssetId,
  type SwapDraft,
  type SwapExecutionReceipt,
  type SwapFill,
  type SwapPolicyCheck,
  type SwapQuote,
  type SwapReservation,
} from "@/lib/swap/drafts";
import {
  requestSwapDraft,
  requestSwapFill,
  requestSwapOperatorStatus,
  requestSwapQuote,
  requestSwapReserve,
  requestSwapStatus,
} from "@/lib/swap/client";
import type { SwapOperatorStatus } from "@/lib/swap/operatorConfig";

export default function WalletSwapPage() {
  const params = useParams<{ name: string }>();
  const rawName = params?.name ?? "";
  const walletName = useMemo(() => {
    try {
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  }, [rawName]);
  const displayName = toDisplayName(walletName);
  const encoded = encodeURIComponent(walletName);
  const [from, setFrom] = useState<SwapAssetId>("BTC");
  const [to, setTo] = useState<SwapAssetId>("SOL");
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<SwapQuote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SwapDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [receipt, setReceipt] = useState<SwapExecutionReceipt | null>(null);
  const [reservation, setReservation] = useState<SwapReservation | null>(null);
  const [fill, setFill] = useState<SwapFill | null>(null);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);
  const [operatorStatus, setOperatorStatus] =
    useState<SwapOperatorStatus | null>(null);
  const [drafts, setDrafts] = useState<SwapDraft[]>(() =>
    listSwapDrafts(walletName),
  );

  const executable = quoteIsExecutable(quote);

  useEffect(() => {
    let cancelled = false;
    void requestSwapOperatorStatus()
      .then((response) => {
        if (!cancelled) setOperatorStatus(response.operator);
      })
      .catch(() => {
        if (!cancelled) setOperatorStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = amount.trim();
    setDraft(null);
    setReceipt(null);
    setReservation(null);
    setFill(null);
    setExecutionMessage(null);
    if (!trimmed || Number(trimmed) <= 0 || from === to) {
      setQuote(null);
      setQuoteError(null);
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setQuote(null);
    setQuoteLoading(true);
    setQuoteError(null);
    const timer = window.setTimeout(() => {
      void requestSwapQuote({ from, to, amount: trimmed })
        .then((response) => {
          if (cancelled) return;
          setQuote(response.quote);
        })
        .catch((error) => {
          if (cancelled) return;
          setQuote(null);
          setQuoteError(
            error instanceof Error ? error.message : "Could not quote swap.",
          );
        })
        .finally(() => {
          if (!cancelled) setQuoteLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [amount, from, to]);

  async function saveDraft() {
    if (!quote || !executable) return;
    setDraftLoading(true);
    setExecutionMessage(null);
    try {
      const response = await requestSwapDraft({ walletName, quote });
      const next = storeSwapDraft(response.draft);
      setDraft(next);
      setDrafts(listSwapDrafts(walletName));
    } catch (error) {
      setQuoteError(
        error instanceof Error ? error.message : "Could not save swap draft.",
      );
    } finally {
      setDraftLoading(false);
    }
  }

  async function checkExecution() {
    if (!draft) return;
    setExecuteLoading(true);
    setExecutionMessage(null);
    try {
      const reserve = await requestSwapReserve({ draft });
      setReservation(reserve.reservation);
      const filled = await requestSwapFill({
        reservationId: reserve.reservation.id,
      });
      setFill(filled.fill);
      setReceipt(filled.fill.receipt);
      setExecutionMessage(filled.fill.message);
    } catch (error) {
      setExecutionMessage(
        error instanceof Error ? error.message : "Could not check execution.",
      );
    } finally {
      setExecuteLoading(false);
    }
  }

  useEffect(() => {
    if (!fill) return;
    if (fill.status === "settled" || fill.status === "blocked") return;
    const timer = window.setInterval(() => {
      void requestSwapStatus(fill.id)
        .then((response) => {
          if (response.fill) {
            setFill(response.fill);
            setReceipt(response.fill.receipt);
            setExecutionMessage(response.fill.message);
          }
          if (response.reservation) setReservation(response.reservation);
        })
        .catch((error) => {
          setExecutionMessage(
            error instanceof Error ? error.message : "Could not refresh status.",
          );
        });
    }, 4000);
    return () => window.clearInterval(timer);
  }, [fill]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <Link
          href={`/app/wallet/${encoded}`}
          className="inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 text-xs font-medium text-text-soft transition-colors hover:border-border-strong hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Wallet
        </Link>
        <span className="rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-semibold text-accent">
          Testnet MVP
        </span>
      </header>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Repeat2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Private swap starts public
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-text-strong sm:text-3xl">
              Swap BTC to SOL.
            </h1>
            <p className="mt-2 text-sm leading-6 text-text-soft">
              Review the exact result. Approve only when it matches.
            </p>
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col gap-4">
          <SwapAssetPicker
            title="From"
            selected={from}
            other={to}
            onSelect={(next) => {
              setFrom(next);
              if (next === to) setTo(from);
            }}
          />
          <SwapAssetPicker
            title="To"
            selected={to}
            other={from}
            onSelect={(next) => {
              setTo(next);
              if (next === from) setFrom(to);
            }}
          />
          <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
            <SendAmountField
              id="swap-amount"
              ticker={from}
              label="Amount"
              value={amount}
              onChange={(event) =>
                setAmount(event.currentTarget.value.replace(/[^\d.]/g, ""))
              }
              placeholder="0"
              footer={`From ${displayName}`}
              autoFocus
            />
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <SwapReview
            quote={quote}
            executable={executable}
            loading={quoteLoading || draftLoading}
            error={quoteError}
            onSave={saveDraft}
          />
          <OperatorSetup status={operatorStatus} />
          {draft ? (
            <DraftReceipt
              draft={draft}
              onExecute={checkExecution}
              busy={executeLoading}
            />
          ) : null}
          {receipt ? (
            <ExecutionReceipt
              receipt={receipt}
              message={executionMessage}
              reservation={reservation}
              fill={fill}
            />
          ) : null}
          {drafts.length > 0 ? <RecentDrafts drafts={drafts} /> : null}
        </aside>
      </section>
    </div>
  );
}

function OperatorSetup({ status }: { status: SwapOperatorStatus | null }) {
  if (!status) return null;
  const missing = status.requirements.filter((item) => item.state === "missing");
  const ready = status.requirements.length - missing.length;

  return (
    <details className="group rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-text-strong">
        <span className="min-w-0">
          <span className="block">Solver setup</span>
          <span className="block truncate text-xs font-normal text-text-soft">
            {status.message}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span
            className={clsx(
              "rounded-full border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.16em]",
              status.state === "ready"
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-warning/40 bg-warning/10 text-warning",
            )}
          >
            {ready}/{status.requirements.length}
          </span>
          <ChevronDown className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180" />
        </span>
      </summary>
      <div className="border-t border-border-soft px-4 py-3">
        <div className="grid gap-2">
          {status.requirements.map((item) => (
            <div
              key={item.key}
              className="flex items-center justify-between gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs font-medium text-text-strong">
                  {item.label}
                </span>
                <span className="block truncate font-mono text-[10px] text-text-soft">
                  {item.key}
                </span>
              </span>
              <span
                className={clsx(
                  "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
                  item.state === "ready" && "bg-accent/10 text-accent",
                  item.state === "dev" && "bg-warning/10 text-warning",
                  item.state === "missing" && "bg-danger/10 text-danger",
                )}
              >
                {item.state}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-2">
          {status.funding.map((item) => (
            <div
              key={item.asset}
              className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs text-text-soft"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-text-strong">
                  {item.asset} vault
                </span>
                <span>
                  {item.available} {item.asset === "Collateral" ? "USD" : item.asset}
                </span>
              </div>
              <p className="mt-1 truncate font-mono text-[10px]">
                {item.address || item.vaultEnv}
              </p>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

function SwapAssetPicker({
  title,
  selected,
  other,
  onSelect,
}: {
  title: string;
  selected: SwapAssetId;
  other: SwapAssetId;
  onSelect: (asset: SwapAssetId) => void;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          {title}
        </h2>
        <span className="text-xs font-medium text-text-soft">{selected}</span>
      </div>
      <div className="grid gap-2">
        {SWAP_ASSETS.map((asset) => {
          const active = asset.id === selected;
          const disabled = asset.id === other;
          return (
            <button
              key={asset.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(asset.id)}
              className={clsx(
                "flex min-h-tap items-center gap-3 rounded-soft border px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                active
                  ? "border-accent/60 bg-accent/10 text-text-strong"
                  : "border-border-soft bg-canvas text-text-soft hover:border-border-strong hover:text-text-strong",
                disabled && "cursor-not-allowed opacity-40",
              )}
            >
              <ChainBadge chain={asset.chain} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {asset.chain.name}
                </span>
                <span className="block text-xs text-text-soft">
                  {asset.phase === "testnet-ready" ? "Testnet route" : "Later"}
                </span>
              </span>
              {active ? <Check className="h-4 w-4 text-accent" /> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SwapReview({
  quote,
  executable,
  loading,
  error,
  onSave,
}: {
  quote: SwapQuote | null;
  executable: boolean;
  loading: boolean;
  error: string | null;
  onSave: () => void;
}) {
  const fromAsset = quote ? swapAsset(quote.from) : null;
  const toAsset = quote ? swapAsset(quote.to) : null;

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <h2 className="text-sm font-medium text-text-strong">Review</h2>
      <div className="mt-4 rounded-soft border border-border-soft bg-canvas p-3">
        {quote && fromAsset && toAsset ? (
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-text-soft">You receive about</p>
              <p className="mt-1 font-numerals text-2xl font-semibold text-text-strong">
                {quote.receiveAmount} {quote.to}
              </p>
              <p className="mt-1 text-xs text-text-soft">
                Minimum {quote.minReceiveAmount} {quote.to}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ChainBadge chain={fromAsset.chain} size="sm" />
              <ArrowRight className="h-4 w-4 text-text-soft" />
              <ChainBadge chain={toAsset.chain} size="sm" />
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-soft">
            {loading ? "Getting quote..." : "Enter an amount to see the result."}
          </p>
        )}
      </div>
      {error ? (
        <p className="mt-2 text-xs leading-5 text-danger">{error}</p>
      ) : null}

      <div className="mt-4 grid gap-2">
        <PlanRow
          icon={<ShieldCheck className="h-4 w-4" />}
          title="Policy"
          value={quote ? (executable ? "Pass" : "Review") : "Waiting"}
          active={Boolean(quote && executable)}
        />
        <PlanRow
          icon={<LockKeyhole className="h-4 w-4" />}
          title="Ika"
          value="Native signing"
          active={Boolean(quote)}
        />
        <PlanRow
          icon={<Clock className="h-4 w-4" />}
          title="Route"
          value={quote ? `~${Math.ceil(quote.etaSeconds / 60)} min` : "Testnet"}
          active={Boolean(quote)}
        />
      </div>

      <details className="group mt-4 rounded-soft border border-border-soft bg-canvas">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-3 text-sm font-medium text-text-strong">
          Details
          <ChevronDown className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180" />
        </summary>
        <div className="border-t border-border-soft px-3 py-3 text-xs leading-5 text-text-soft">
          <p>
            This MVP saves a local execution draft. Real settlement comes next:
            backend quote verification, route and solver allowlists, on-chain
            policy checks, Ika signing, and replay protection. Encrypt privacy
            comes after the public bridgeless path is stable.
          </p>
          {quote ? (
            <>
              <dl className="mt-3 grid grid-cols-2 gap-2">
                <dt>Mode</dt>
                <dd className="text-right text-text-strong">Mock testnet</dd>
                <dt>Fee estimate</dt>
                <dd className="text-right text-text-strong">
                  {formatUsd(quote.feeUsd)}
                </dd>
                <dt>Swap size</dt>
                <dd className="text-right text-text-strong">
                  {formatUsd(quote.amountUsd)}
                </dd>
                <dt>Max loss</dt>
                <dd className="text-right text-text-strong">
                  {(quote.maxLossBps / 100).toFixed(2)}%
                </dd>
                <dt>Solver</dt>
                <dd className="text-right text-text-strong">
                  {quote.solver.name}
                </dd>
              </dl>
              <PolicyChecks checks={quote.policyChecks} />
              <ol className="mt-4 grid gap-2">
                {quote.route.map((step, index) => (
                  <li
                    key={step}
                    className="flex items-center gap-2 rounded-soft border border-border-soft bg-surface-raised px-3 py-2"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-canvas font-mono text-[10px] text-text-soft">
                      {index + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </div>
      </details>

      <Button
        className="mt-4"
        size="lg"
        fullWidth
        disabled={!executable || loading}
        onClick={onSave}
      >
        {loading
          ? "Checking"
          : quote
          ? executable
            ? "Save draft"
            : "Route not ready"
          : "Review first"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

function PlanRow({
  icon,
  title,
  value,
  active,
}: {
  icon: ReactNode;
  title: string;
  value: string;
  active: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-3 rounded-soft border px-3 py-2",
        active
          ? "border-accent/40 bg-accent/10"
          : "border-border-soft bg-canvas",
      )}
    >
      <span
        className={clsx(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
          active ? "bg-accent/15 text-accent" : "bg-glass-soft text-text-soft",
        )}
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-medium text-text-strong">{title}</p>
        <p className="truncate text-xs text-text-soft">{value}</p>
      </div>
    </div>
  );
}

function PolicyChecks({ checks }: { checks: SwapPolicyCheck[] }) {
  return (
    <section className="mt-4">
      <h3 className="text-xs font-medium text-text-strong">Checks</h3>
      <ul className="mt-2 grid gap-2">
        {checks.map((check) => (
          <li
            key={check.id}
            className="flex gap-2 rounded-soft border border-border-soft bg-surface-raised px-3 py-2"
          >
            <Check
              className={clsx(
                "mt-0.5 h-3.5 w-3.5 shrink-0",
                check.passed ? "text-accent" : "text-warning",
              )}
              aria-hidden="true"
            />
            <span>
              <span className="block text-xs font-medium text-text-strong">
                {check.label}
              </span>
              <span className="block text-xs text-text-soft">{check.detail}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function DraftReceipt({
  draft,
  onExecute,
  busy,
}: {
  draft: SwapDraft;
  onExecute: () => void;
  busy: boolean;
}) {
  return (
    <section className="rounded-card border border-accent/40 bg-accent/10 p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-text-on-accent">
          <Check className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-strong">
            Draft saved
          </h2>
          <p className="mt-1 text-xs leading-5 text-text-soft">
            Quote {draft.id.slice(0, 8)} is saved locally for backend/Ika wiring.
          </p>
        </div>
      </div>
      <Button
        className="mt-4"
        size="md"
        fullWidth
        onClick={onExecute}
        disabled={busy}
      >
        {busy ? "Checking execution" : "Check execution"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>
    </section>
  );
}

function ExecutionReceipt({
  receipt,
  message,
  reservation,
  fill,
}: {
  receipt: SwapExecutionReceipt;
  message: string | null;
  reservation: SwapReservation | null;
  fill: SwapFill | null;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-accent">
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-text-strong">
            {receipt.title}
          </h2>
          <p className="mt-1 text-xs leading-5 text-text-soft">
            {message ?? receipt.message}
          </p>
        </div>
      </div>
      {reservation ? (
        <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs text-text-soft">
          <div className="flex items-center justify-between gap-3">
            <span>Liquidity</span>
            <span className="font-medium text-text-strong">
              {reservation.status}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-3">
            <span>Collateral</span>
            <span className="font-medium text-text-strong">
              {formatUsd(reservation.collateral.availableUsd)}
            </span>
          </div>
        </div>
      ) : null}
      {fill ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
          Status · {fill.status.replace(/_/g, " ")}
        </p>
      ) : null}
      <details className="group mt-3 rounded-soft border border-border-soft bg-canvas">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-text-strong">
          Execution path
          <ChevronDown className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180" />
        </summary>
        <ol className="grid gap-2 border-t border-border-soft px-3 py-3 text-xs text-text-soft">
          {receipt.route.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span className="text-accent">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </details>
      <details className="group mt-3 rounded-soft border border-border-soft bg-canvas">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-xs font-medium text-text-strong">
          Private policy
          <ChevronDown className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180" />
        </summary>
        <p className="border-t border-border-soft px-3 py-3 text-xs leading-5 text-text-soft">
          {receipt.privatePolicy.message}
        </p>
      </details>
    </section>
  );
}

function RecentDrafts({ drafts }: { drafts: SwapDraft[] }) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <h2 className="text-sm font-medium text-text-strong">Recent drafts</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {drafts.slice(0, 3).map((item) => (
          <li
            key={item.id}
            className="flex items-center justify-between gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <span className="min-w-0 truncate text-xs text-text-soft">
              {item.quote.amount} {item.quote.from} to {item.quote.receiveAmount}{" "}
              {item.quote.to}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-accent">
              Draft
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
