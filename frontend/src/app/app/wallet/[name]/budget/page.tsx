"use client";

// /app/wallet/[name]/budget. The wallet's spending policy editor.
//
// v2 layout:
//   1. Current usage card. "Where am I right now?" Wallet-wide spent
//      this week, plus a per-chain breakdown showing each chain's
//      spend against its cap.
//   2. Wallet-wide weekly cap. Single dollar number across all chains.
//   3. Per-chain caps. Optional dollar caps per chain (Solana,
//      Ethereum, Bitcoin, Zcash). Adds a per-chain ceiling on top of
//      the wallet-wide one.
//   4. Daily velocity. Optional "no more than N sends per day" rule.
//
// Caps are enforced in dollars so the user never has to convert SOL
// to BTC to USDC in their head. Today's enforcement is advisory: the
// /send page bakes the policy impact ("after this: $4.2k of $5k on
// Solana") into the SignPayloadPreview so the user sees the rule
// applied at sign time. Real on-chain enforcement lands when the
// program adds the policy fields.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Check,
  Loader2,
  Wallet as WalletIcon,
  Zap,
} from "lucide-react";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { Button } from "@/components/retail/Button";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { useToast } from "@/components/ui/Toast";
import {
  POLICY_CHAIN_TICKERS,
  saveBudget,
  type PolicyChainTicker,
  type WalletBudget,
} from "@/lib/retail/spendingBudget";
import {
  formatUsd,
  quotePerWhole,
} from "@/lib/retail/priceConversion";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { CHAIN_CATALOG, type ChainMeta } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";

const QUICK_WALLET_AMOUNTS: ReadonlyArray<{ label: string; usd: number }> = [
  { label: "$500", usd: 500 },
  { label: "$1k", usd: 1_000 },
  { label: "$5k", usd: 5_000 },
  { label: "$10k", usd: 10_000 },
  { label: "$50k", usd: 50_000 },
];

const QUICK_CHAIN_AMOUNTS: ReadonlyArray<{ label: string; usd: number }> = [
  { label: "$250", usd: 250 },
  { label: "$1k", usd: 1_000 },
  { label: "$5k", usd: 5_000 },
];

const QUICK_VELOCITY: ReadonlyArray<{ label: string; n: number }> = [
  { label: "3 / day", n: 3 },
  { label: "10 / day", n: 10 },
  { label: "25 / day", n: 25 },
];

interface ChainDraft {
  /// Current input value as a string (so empty / partial typing works).
  amount: string;
  /// True when the user has explicitly toggled the chain off (no cap).
  /// Distinct from "amount empty"; the input shows up either way, but
  /// the "save" payload uses null when unspecified.
  cleared: boolean;
}

export default function BudgetPage() {
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
  const toast = useToast();
  const usage = useWalletBudgetUsage(name);

  const [walletDraft, setWalletDraft] = useState<string>("");
  const [walletNoLimit, setWalletNoLimit] = useState(false);
  const [chainDrafts, setChainDrafts] = useState<Record<PolicyChainTicker, ChainDraft>>(
    () => initialChainDrafts(),
  );
  const [velocityDraft, setVelocityDraft] = useState<string>("");

  // Hydrate drafts from saved policy on mount + when storage changes.
  useEffect(() => {
    if (!name) return;
    const cap = usage.budget?.weeklyUsd;
    if (cap === undefined || cap === null || cap === 0) {
      setWalletDraft("");
      setWalletNoLimit(false);
    } else {
      setWalletDraft(String(cap));
      setWalletNoLimit(false);
    }
    const next = initialChainDrafts();
    for (const t of POLICY_CHAIN_TICKERS) {
      const stored = usage.budget?.perChainUsd?.[t];
      if (stored !== undefined && stored !== null) {
        next[t] = { amount: String(stored), cleared: false };
      }
    }
    setChainDrafts(next);
    const vel = usage.budget?.velocityPerDay;
    setVelocityDraft(vel ? String(vel) : "");
  }, [name, usage.budget?.weeklyUsd, usage.budget?.perChainUsd, usage.budget?.velocityPerDay]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const handleSave = () => {
    // Wallet-wide cap. noLimit collapses to null (no overall cap).
    let weeklyUsd: number | null;
    if (walletNoLimit) {
      weeklyUsd = null;
    } else if (walletDraft.trim() === "") {
      weeklyUsd = null;
    } else {
      const num = Number(walletDraft.trim());
      if (!isFinite(num) || num <= 0) {
        toast.error("Pick a wallet-wide weekly amount", {
          details: "Enter a dollar amount, tap a quick option, or choose No limit.",
        });
        return;
      }
      weeklyUsd = Math.round(num);
    }

    // Per-chain caps. Empty input means "no per-chain cap"; an
    // explicit value sets the cap.
    const perChainUsd: Partial<Record<PolicyChainTicker, number | null>> = {};
    for (const t of POLICY_CHAIN_TICKERS) {
      const draft = chainDrafts[t];
      if (draft.cleared || draft.amount.trim() === "") {
        perChainUsd[t] = null;
        continue;
      }
      const n = Number(draft.amount.trim());
      if (!isFinite(n) || n <= 0) {
        toast.error(`Pick a valid amount for ${t}`, {
          details: `Either enter a dollar amount or clear the ${t} field to leave it uncapped.`,
        });
        return;
      }
      perChainUsd[t] = Math.round(n);
    }

    // Velocity. Empty means no limit.
    let velocityPerDay: number | null;
    if (velocityDraft.trim() === "") {
      velocityPerDay = null;
    } else {
      const v = Number(velocityDraft.trim());
      if (!isFinite(v) || v <= 0 || !Number.isInteger(v)) {
        toast.error("Pick a whole number of sends per day", {
          details: "Or leave the velocity field empty to skip the per-day limit.",
        });
        return;
      }
      velocityPerDay = v;
    }

    saveBudget({
      walletName: name,
      weeklyUsd,
      perChainUsd,
      velocityPerDay,
    });
    toast.success(`${name}'s policy saved`, {
      details: summarisePolicy(weeklyUsd, perChainUsd, velocityPerDay),
    });
    router.push(`/app/wallet/${encodeURIComponent(name)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: toDisplayName(name), href: `/app/wallet/${encodeURIComponent(name)}` },
            { label: "Spending policy" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <WalletIcon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Spending policy
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          How much can {name} spend?
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          One wallet-wide weekly cap, plus optional per-chain caps and a
          daily send-count limit. Sends inside the policy fly through;
          sends that would push past it get a heads-up before signing.
        </p>
      </motion.section>

      <CurrentUsageCard name={name} usage={usage} />

      {/* Wallet-wide cap */}
      <PolicyCard
        title="Wallet-wide weekly cap"
        hint="Across every chain. The single ceiling everything else stacks under."
      >
        <div className="flex items-baseline gap-2">
          <span className="font-display text-2xl text-text-strong">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={walletDraft}
            onChange={(e) => {
              setWalletNoLimit(false);
              setWalletDraft(sanitizeDecimal(e.target.value));
            }}
            placeholder="5,000"
            disabled={walletNoLimit}
            maxLength={20}
            className={
              "flex-1 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-display text-2xl text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest " +
              "disabled:cursor-not-allowed disabled:opacity-50"
            }
          />
          <span className="text-sm text-text-soft">/ week</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_WALLET_AMOUNTS.map((q) => {
            const active = !walletNoLimit && Number(walletDraft) === q.usd;
            return (
              <QuickChip
                key={q.usd}
                label={q.label}
                active={active}
                onClick={() => {
                  setWalletNoLimit(false);
                  setWalletDraft(String(q.usd));
                }}
              />
            );
          })}
          <QuickChip
            label="No limit"
            active={walletNoLimit}
            onClick={() => {
              setWalletNoLimit(true);
              setWalletDraft("");
            }}
          />
        </div>
      </PolicyCard>

      {/* Per-chain caps */}
      <PolicyCard
        title="Per-chain caps (optional)"
        hint="Layer a tighter ceiling on individual chains. Leave empty for no extra limit."
      >
        <ul className="flex flex-col gap-3">
          {POLICY_CHAIN_TICKERS.map((ticker) => {
            const meta = CHAIN_CATALOG.find((c) => c.ticker === ticker);
            if (!meta) return null;
            const draft = chainDrafts[ticker];
            return (
              <ChainCapRow
                key={ticker}
                ticker={ticker}
                meta={meta}
                draft={draft}
                onChange={(patch) =>
                  setChainDrafts((prev) => ({
                    ...prev,
                    [ticker]: { ...prev[ticker], ...patch },
                  }))
                }
              />
            );
          })}
        </ul>
      </PolicyCard>

      {/* Daily velocity */}
      <PolicyCard
        title="Daily send limit (optional)"
        hint="Catches runaway scripts and impulse spends. We'll flag any send that would push you past this in 24 hours."
      >
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Zap className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={velocityDraft}
            onChange={(e) =>
              setVelocityDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 4))
            }
            placeholder="No limit"
            maxLength={4}
            className={
              "w-24 rounded-soft border border-border-soft bg-canvas px-3 py-2 font-display text-lg text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <span className="text-sm text-text-soft">sends per 24 hours</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {QUICK_VELOCITY.map((q) => (
            <QuickChip
              key={q.n}
              label={q.label}
              active={Number(velocityDraft) === q.n}
              onClick={() => setVelocityDraft(String(q.n))}
            />
          ))}
          <QuickChip
            label="No limit"
            active={velocityDraft.trim() === ""}
            onClick={() => setVelocityDraft("")}
          />
        </div>
      </PolicyCard>

      <Button size="lg" fullWidth onClick={handleSave}>
        Save policy
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <p className="text-center text-xs text-text-soft">
        <strong className="text-text-strong">Heads up.</strong> Demo
        prices today ({formatUsd(quotePerWhole("SOL")?.usdPerWhole ?? 0)}{" "}
        / SOL etc.). Caps are nudges; wallet approvals still rule. Real
        on-chain enforcement lands when the policy program ships the
        fields.
      </p>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────

function PolicyCard({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        {title}
      </p>
      <p className="mt-1 text-xs text-text-soft">{hint}</p>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ChainCapRow({
  ticker,
  meta,
  draft,
  onChange,
}: {
  ticker: PolicyChainTicker;
  meta: ChainMeta;
  draft: ChainDraft;
  onChange: (patch: Partial<ChainDraft>) => void;
}) {
  const quote = quotePerWhole(ticker);
  const num = Number(draft.amount);
  const wholeEquivalent =
    quote && isFinite(num) && num > 0
      ? `≈ ${(num / quote.usdPerWhole).toLocaleString("en-US", {
          maximumFractionDigits: meta.displayDecimals,
        })} ${ticker}`
      : null;

  return (
    <li className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex items-center gap-3">
        <ChainBadge chain={meta} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">{meta.name}</p>
          <p className="text-[11px] text-text-soft">{meta.description}</p>
        </div>
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="font-display text-base text-text-strong">$</span>
        <input
          type="text"
          inputMode="decimal"
          value={draft.amount}
          onChange={(e) =>
            onChange({
              amount: sanitizeDecimal(e.target.value),
              cleared: e.target.value.trim() === "",
            })
          }
          placeholder="No cap"
          maxLength={20}
          className={
            "flex-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-1.5 text-base text-text-strong outline-none " +
            "transition-[border-color,box-shadow] duration-base ease-out-soft " +
            "focus:border-accent focus:shadow-accent-rest"
          }
        />
        <span className="text-xs text-text-soft">/ week</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {QUICK_CHAIN_AMOUNTS.map((q) => (
          <QuickChip
            key={q.usd}
            label={q.label}
            active={Number(draft.amount) === q.usd}
            onClick={() => onChange({ amount: String(q.usd), cleared: false })}
            small
          />
        ))}
        <QuickChip
          label="Clear"
          active={draft.cleared || draft.amount.trim() === ""}
          onClick={() => onChange({ amount: "", cleared: true })}
          small
        />
        {wholeEquivalent && (
          <span className="ml-1 text-[11px] text-text-soft">
            {wholeEquivalent}
          </span>
        )}
      </div>
    </li>
  );
}

function QuickChip({
  label,
  active,
  onClick,
  small = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border font-medium transition-colors duration-base ease-out-soft " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
        (small ? "px-2.5 py-0.5 text-[11px] " : "px-3 py-1 text-xs ") +
        (active
          ? "border-accent bg-accent/10 text-accent"
          : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
      }
    >
      {label}
    </button>
  );
}

function CurrentUsageCard({
  name,
  usage,
}: {
  name: string;
  usage: ReturnType<typeof useWalletBudgetUsage>;
}) {
  if (usage.loading) {
    return (
      <div className="flex items-center justify-center rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <Loader2
          className="h-4 w-4 animate-spin text-text-soft"
          aria-hidden="true"
        />
        <span className="ml-2 text-xs text-text-soft">
          Reading {name}&rsquo;s recent spending…
        </span>
      </div>
    );
  }

  const { spentUsd, proposalCount, remainingUsd, pctUsed, budget, perChain, sendsLast24h } = usage;
  const cap = budget?.weeklyUsd ?? null;
  const noBudget = cap === null || cap === undefined;
  const cappedChains = perChain.filter((c) => c.cap !== null);

  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        This week
      </p>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <span className="font-display text-display-xs text-text-strong">
          {formatUsd(spentUsd)}
        </span>
        <span className="text-xs text-text-soft">
          {proposalCount} {proposalCount === 1 ? "send" : "sends"}{" "}
          {budget?.velocityPerDay
            ? `· ${sendsLast24h} of ${budget.velocityPerDay} today`
            : ""}
        </span>
      </div>
      {!noBudget && cap > 0 && pctUsed !== null && (
        <UsageBar pct={pctUsed} caption={
          remainingUsd !== null && remainingUsd >= 0
            ? `${formatUsd(remainingUsd)} left of ${formatUsd(cap)} wallet-wide`
            : `${formatUsd(Math.abs(remainingUsd ?? 0))} over the ${formatUsd(cap)} wallet-wide cap`
        } />
      )}
      {cappedChains.length > 0 && (
        <ul className="mt-4 flex flex-col gap-2 border-t border-border-soft pt-3">
          {cappedChains.map((c) => {
            const chainCap = c.cap;
            if (chainCap === null) return null;
            return (
              <li key={c.ticker}>
                <div className="flex items-baseline justify-between gap-2 text-[11px] text-text-soft">
                  <span className="font-medium text-text-strong">{c.ticker}</span>
                  <span>
                    {formatUsd(c.spentUsd)} of {formatUsd(chainCap)}
                  </span>
                </div>
                <UsageBar
                  pct={c.pctUsed ?? 0}
                  thin
                  caption={null}
                />
              </li>
            );
          })}
        </ul>
      )}
      {noBudget && (
        <p className="mt-2 text-xs text-text-soft">
          No cap set yet. Pick one below to start tracking.
        </p>
      )}
    </div>
  );
}

function UsageBar({
  pct,
  caption,
  thin = false,
}: {
  pct: number;
  caption: string | null;
  thin?: boolean;
}) {
  return (
    <>
      <div
        className={
          "mt-2 overflow-hidden rounded-full bg-border-soft " +
          (thin ? "h-1" : "h-2")
        }
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{ width: `${Math.round(pct * 100)}%` }}
          className={
            "h-full transition-[width] duration-base ease-out-soft " +
            (pct >= 1
              ? "bg-danger"
              : pct >= 0.8
                ? "bg-warning"
                : "bg-accent")
          }
        />
      </div>
      {caption && (
        <p className="mt-2 text-xs text-text-soft">{caption}</p>
      )}
    </>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function initialChainDrafts(): Record<PolicyChainTicker, ChainDraft> {
  const out = {} as Record<PolicyChainTicker, ChainDraft>;
  for (const t of POLICY_CHAIN_TICKERS) {
    out[t] = { amount: "", cleared: false };
  }
  return out;
}

function sanitizeDecimal(raw: string): string {
  const stripped = raw.replace(/[^\d.]/g, "");
  const [whole = "", frac] = stripped.split(".");
  return frac === undefined
    ? whole.slice(0, 12)
    : `${whole.slice(0, 12)}.${frac.slice(0, 2)}`;
}

function summarisePolicy(
  weeklyUsd: number | null,
  perChainUsd: Partial<Record<PolicyChainTicker, number | null>>,
  velocityPerDay: number | null,
): string {
  const parts: string[] = [];
  if (weeklyUsd === null) {
    parts.push("No wallet-wide cap");
  } else {
    parts.push(`${formatUsd(weeklyUsd)}/week wallet-wide`);
  }
  const chains = POLICY_CHAIN_TICKERS.filter(
    (t) => perChainUsd[t] !== null && perChainUsd[t] !== undefined,
  );
  if (chains.length > 0) {
    parts.push(`${chains.length} chain ${chains.length === 1 ? "cap" : "caps"}`);
  }
  if (velocityPerDay !== null && velocityPerDay > 0) {
    parts.push(`${velocityPerDay} sends/day max`);
  }
  return parts.join(" · ");
}

export type { WalletBudget };
