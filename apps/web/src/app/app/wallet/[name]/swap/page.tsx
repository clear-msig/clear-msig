"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
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
  buildSwapQuote,
  quoteIsExecutable,
  storeSwapDraft,
  swapAsset,
  type SwapAssetId,
  type SwapDraft,
  type SwapExecutionReceipt,
  type SwapFill,
  type SwapQuote,
  type SwapReservation,
} from "@/lib/swap/drafts";
import {
  requestSwapDraft,
  requestSwapFill,
  requestSwapReserve,
  requestSwapStatus,
} from "@/lib/swap/client";

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
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [draft, setDraft] = useState<SwapDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [executeLoading, setExecuteLoading] = useState(false);
  const [receipt, setReceipt] = useState<SwapExecutionReceipt | null>(null);
  const [reservation, setReservation] = useState<SwapReservation | null>(null);
  const [fill, setFill] = useState<SwapFill | null>(null);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);
  const [openAssetPicker, setOpenAssetPicker] = useState<"from" | "to" | null>(
    null,
  );

  const executable = quoteIsExecutable(quote);

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
      return;
    }
    setQuoteError(null);
    setQuote(buildSwapQuote({ from, to, amount: trimmed }));
  }, [amount, from, to]);

  async function saveDraft() {
    if (!quote || !executable) return;
    setDraftLoading(true);
    setExecutionMessage(null);
    try {
      const response = await requestSwapDraft({ walletName, quote });
      const next = storeSwapDraft(response.draft);
      setDraft(next);
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
    <div className="mx-auto box-border flex w-full max-w-[calc(100vw-1.5rem)] flex-col gap-2.5 overflow-hidden sm:max-w-3xl sm:gap-4 lg:max-w-5xl">
      <header className="flex min-w-0 items-center justify-between gap-2">
        <Link
          href={`/app/wallet/${encoded}`}
          className="inline-flex min-h-tap min-w-0 items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 text-xs font-medium text-text-soft transition-colors hover:border-border-strong hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Wallet
        </Link>
        <span className="hidden rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-semibold text-accent sm:inline-flex">
          Testnet MVP
        </span>
      </header>

      <section className="hidden rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:block sm:p-4">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Repeat2 className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Private swap starts public
            </p>
            <h1 className="mt-1 font-display text-2xl font-semibold text-text-strong sm:text-3xl">
              Swap your crypto.
            </h1>
          </div>
        </div>
      </section>

      <section className="grid min-w-0 gap-2.5 sm:gap-3 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-2.5 sm:gap-3">
          <SwapPairPicker
            from={from}
            to={to}
            open={openAssetPicker}
            onToggle={setOpenAssetPicker}
            onReverse={() => {
              setFrom(to);
              setTo(from);
              setOpenAssetPicker(null);
            }}
            onSelectFrom={(next) => {
              setFrom(next);
              if (next === to) setTo(from);
              setOpenAssetPicker(null);
            }}
            onSelectTo={(next) => {
              setTo(next);
              if (next === from) setFrom(to);
              setOpenAssetPicker(null);
            }}
          />
          <section className="w-full min-w-0 overflow-hidden rounded-card border border-border-soft bg-surface-raised p-2.5 shadow-card-rest sm:p-4">
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

        <aside className="flex min-w-0 flex-col gap-2.5 sm:gap-4">
          <SwapReview
            quote={quote}
            draft={draft}
            executable={executable}
            loading={draftLoading || executeLoading}
            error={quoteError}
            onSave={saveDraft}
            onExecute={checkExecution}
          />
          {receipt ? (
            <ExecutionReceipt
              receipt={receipt}
              message={executionMessage}
              reservation={reservation}
              fill={fill}
            />
          ) : null}
        </aside>
      </section>
    </div>
  );
}

function SwapPairPicker({
  from,
  to,
  open,
  onToggle,
  onReverse,
  onSelectFrom,
  onSelectTo,
}: {
  from: SwapAssetId;
  to: SwapAssetId;
  open: "from" | "to" | null;
  onToggle: (next: "from" | "to" | null) => void;
  onReverse: () => void;
  onSelectFrom: (asset: SwapAssetId) => void;
  onSelectTo: (asset: SwapAssetId) => void;
}) {
  return (
    <section className="w-full min-w-0 overflow-hidden rounded-card border border-border-soft bg-surface-raised p-2.5 shadow-card-rest sm:p-4">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_2.25rem_minmax(0,1fr)] items-stretch gap-1.5 sm:grid-cols-[minmax(0,1fr)_2.5rem_minmax(0,1fr)] sm:gap-2">
        <AssetSelectButton
          label="From"
          asset={from}
          open={open === "from"}
          onClick={() => onToggle(open === "from" ? null : "from")}
        />
        <button
          type="button"
          aria-label="Reverse swap pair"
          onClick={onReverse}
          className="flex min-h-tap w-9 min-w-0 items-center justify-center rounded-full border border-border-soft bg-canvas text-text-soft transition-colors hover:border-accent/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised sm:w-10"
        >
          <Repeat2 className="h-4 w-4" aria-hidden="true" />
        </button>
        <AssetSelectButton
          label="To"
          asset={to}
          open={open === "to"}
          onClick={() => onToggle(open === "to" ? null : "to")}
        />
      </div>
      {open === "from" ? (
        <AssetChooser selected={from} other={to} onSelect={onSelectFrom} />
      ) : null}
      {open === "to" ? (
        <AssetChooser selected={to} other={from} onSelect={onSelectTo} />
      ) : null}
    </section>
  );
}

function AssetSelectButton({
  label,
  asset,
  open,
  onClick,
}: {
  label: string;
  asset: SwapAssetId;
  open: boolean;
  onClick: () => void;
}) {
  const meta = swapAsset(asset);
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onClick}
      className={clsx(
        "flex min-h-tap min-w-0 items-center gap-2 overflow-hidden rounded-soft border px-2 py-2 text-left transition-colors sm:gap-3 sm:px-3",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        open
          ? "border-accent/60 bg-accent/10"
          : "border-border-soft bg-canvas hover:border-border-strong",
      )}
    >
      <ChainBadge chain={meta.chain} size="sm" />
      <span className="min-w-0 flex-1 overflow-hidden">
        <span className="block font-mono text-[9px] uppercase tracking-[0.18em] text-text-soft">
          {label}
        </span>
        <span className="block truncate text-sm font-semibold text-text-strong">
          {asset}
        </span>
      </span>
      <ChevronDown
        className={clsx(
          "h-4 w-4 shrink-0 text-text-soft transition-transform",
          open && "rotate-180",
        )}
        aria-hidden="true"
      />
    </button>
  );
}

function AssetChooser({
  selected,
  other,
  onSelect,
}: {
  selected: SwapAssetId;
  other: SwapAssetId;
  onSelect: (asset: SwapAssetId) => void;
}) {
  return (
    <div className="mt-2 grid min-w-0 gap-1.5 rounded-soft border border-border-soft bg-canvas p-1.5 sm:gap-2 sm:p-2">
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
              "flex min-h-tap min-w-0 items-center gap-2 overflow-hidden rounded-soft border px-2.5 py-2 text-left transition-colors sm:gap-3 sm:px-3",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              active
                ? "border-accent/60 bg-accent/10 text-text-strong"
                : "border-border-soft bg-surface-raised text-text-soft hover:border-border-strong hover:text-text-strong",
              disabled && "cursor-not-allowed opacity-40",
            )}
          >
            <ChainBadge chain={asset.chain} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">
                {asset.chain.name}
              </span>
              <span className="block text-xs text-text-soft">
                {asset.phase === "testnet-ready" ? "Testnet" : "Later"}
              </span>
            </span>
            {active ? <Check className="h-4 w-4 text-accent" /> : null}
          </button>
        );
      })}
    </div>
  );
}

function SwapReview({
  quote,
  draft,
  executable,
  loading,
  error,
  onSave,
  onExecute,
}: {
  quote: SwapQuote | null;
  draft: SwapDraft | null;
  executable: boolean;
  loading: boolean;
  error: string | null;
  onSave: () => void;
  onExecute: () => void;
}) {
  const fromAsset = quote ? swapAsset(quote.from) : null;
  const toAsset = quote ? swapAsset(quote.to) : null;
  const canSwap = Boolean(draft && executable);

  return (
    <section className="w-full min-w-0 overflow-hidden rounded-card border border-border-soft bg-surface-raised p-2.5 shadow-card-rest sm:p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-text-strong">Review</h2>
        {quote ? (
          <span className="text-xs font-medium text-text-soft">
            ~{Math.ceil(quote.etaSeconds / 60)} min
          </span>
        ) : null}
      </div>
      <div className="mt-2.5 min-w-0 overflow-hidden rounded-soft border border-border-soft bg-canvas p-2.5 sm:mt-3 sm:p-3 lg:flex lg:items-center lg:justify-between lg:gap-5">
        {quote && fromAsset && toAsset ? (
          <>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-text-soft">You receive about</p>
              <p className="mt-1 font-numerals text-xl font-semibold text-text-strong sm:text-2xl">
                {quote.receiveAmount} {quote.to}
              </p>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-text-soft">
                <dt>Minimum</dt>
                <dd className="text-right text-text-strong">
                  {quote.minReceiveAmount} {quote.to}
                </dd>
                <dt>Fee</dt>
                <dd className="text-right text-text-strong">
                  {formatUsd(quote.feeUsd)}
                </dd>
              </dl>
            </div>
            <div className="mt-3 flex shrink-0 items-center justify-end gap-2 lg:mt-0">
              <ChainBadge chain={fromAsset.chain} size="sm" />
              <ArrowRight className="h-4 w-4 text-text-soft" />
              <ChainBadge chain={toAsset.chain} size="sm" />
            </div>
          </>
        ) : (
          <p className="text-sm text-text-soft">Enter an amount to see the result.</p>
        )}
      </div>
      {error ? (
        <p className="mt-2 text-xs leading-5 text-danger">{error}</p>
      ) : null}

      {quote ? (
        <details className="group mt-2.5 rounded-soft border border-border-soft bg-canvas sm:mt-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-sm font-medium text-text-strong sm:py-3">
            Price details
            <ChevronDown className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180" />
          </summary>
          <div className="border-t border-border-soft px-3 py-2.5 text-xs leading-5 text-text-soft sm:py-3">
            <dl className="grid grid-cols-2 gap-2">
              <dt>Send</dt>
              <dd className="text-right text-text-strong">
                {quote.amount} {quote.from}
              </dd>
              <dt>Receive</dt>
              <dd className="text-right text-text-strong">
                {quote.receiveAmount} {quote.to}
              </dd>
              <dt>Max loss</dt>
              <dd className="text-right text-text-strong">
                {(quote.maxLossBps / 100).toFixed(2)}%
              </dd>
            </dl>
          </div>
        </details>
      ) : null}

      <Button
        className="mt-2.5 sm:mt-3"
        size="lg"
        fullWidth
        disabled={!executable || loading}
        onClick={canSwap ? onExecute : onSave}
      >
        {loading
          ? "Checking"
          : quote
          ? executable
            ? canSwap
              ? "Swap"
              : "Review swap"
            : "Route not ready"
          : "Review first"}
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
  const status = fill?.status.replace(/_/g, " ") ?? receipt.status;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-2.5 shadow-card-rest sm:p-4">
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
            <span>Status</span>
            <span className="font-medium text-text-strong">
              {status}
            </span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
