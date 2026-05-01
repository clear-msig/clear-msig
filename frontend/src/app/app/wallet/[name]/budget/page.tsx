"use client";

// /app/wallet/[name]/budget — set the wallet's weekly spending limit.
//
// One number, one decision: how much can {wallet} spend per week,
// across every chain it's bound to? Cap is enforced in dollars so
// the user doesn't have to convert SOL to BTC to USDC in their head.
//
// V1 is advisory — the cap is stored locally and surfaced as a
// running tally on the hub + a hint on /send. Real on-chain
// enforcement lands when the program adds a `weekly_spend_cap_usd`
// (or its FHE-encrypted equivalent). Same ship pattern as
// allowances.

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Loader2, Wallet as WalletIcon } from "lucide-react";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { Button } from "@/components/retail/Button";
import { useToast } from "@/components/ui/Toast";
import {
  saveBudget,
  type WalletBudget,
} from "@/lib/retail/spendingBudget";
import {
  formatUsd,
  quotePerWhole,
} from "@/lib/retail/priceConversion";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";

const QUICK_AMOUNTS: ReadonlyArray<{ label: string; usd: number }> = [
  { label: "$500", usd: 500 },
  { label: "$1k", usd: 1_000 },
  { label: "$5k", usd: 5_000 },
  { label: "$10k", usd: 10_000 },
  { label: "$50k", usd: 50_000 },
];

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

  const [draftAmount, setDraftAmount] = useState<string>("");
  const [noLimit, setNoLimit] = useState(false);

  // Hydrate the draft from the saved value on mount + when the
  // stored budget changes (after a save round-trips through the
  // store). Empty string is the "set me" placeholder; "noLimit"
  // is its own checkbox.
  useEffect(() => {
    if (!name) return;
    const cap = usage.budget?.weeklyUsd;
    if (cap === undefined || cap === null) {
      setDraftAmount("");
      setNoLimit(false);
    } else if (cap === 0) {
      setDraftAmount("");
      setNoLimit(false);
    } else {
      setDraftAmount(String(cap));
      setNoLimit(false);
    }
  }, [name, usage.budget?.weeklyUsd]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  const handleSave = () => {
    if (noLimit) {
      saveBudget(name, null);
      toast.success(`No limit on ${name}`, {
        details: "We'll stop showing the weekly tracker on the hub.",
      });
      router.push(`/app/wallet/${encodeURIComponent(name)}`);
      return;
    }
    const num = Number(draftAmount.trim());
    if (!isFinite(num) || num <= 0) {
      toast.error("Pick a weekly amount", {
        details: "Enter a dollar amount or tap one of the quick options.",
      });
      return;
    }
    saveBudget(name, Math.round(num));
    toast.success(`${name}'s weekly limit is ${formatUsd(num)}`, {
      details: "We'll show usage against this cap on the wallet hub.",
    });
    router.push(`/app/wallet/${encodeURIComponent(name)}`);
  };

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumb
        segments={[
          { label: "Wallets", href: "/app/wallet" },
          { label: name, href: `/app/wallet/${encodeURIComponent(name)}` },
          { label: "Weekly limit" },
        ]}
      />

      <motion.section
        {...motionProps}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <WalletIcon className="h-6 w-6" strokeWidth={1.75} />
        </div>
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Weekly spending limit
        </p>
        <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
          How much can {name} spend per week?
        </h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-soft">
          One cap, in dollars, across every chain {name} is bound to.
          Sends inside the limit fly through approval; sends that would
          push the wallet past it get a heads-up before signing.
        </p>
      </motion.section>

      {/* Current usage card — answers "where am I right now?" before
          the user changes anything. */}
      <CurrentUsageCard name={name} usage={usage} />

      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
          Pick a weekly cap
        </p>

        <div className="mt-3 flex items-baseline gap-2">
          <span className="font-display text-2xl text-text-strong">$</span>
          <input
            type="text"
            inputMode="decimal"
            value={draftAmount}
            onChange={(e) => {
              setNoLimit(false);
              const stripped = e.target.value.replace(/[^\d.]/g, "");
              const [whole = "", frac] = stripped.split(".");
              const next =
                frac === undefined
                  ? whole.slice(0, 12)
                  : `${whole.slice(0, 12)}.${frac.slice(0, 2)}`;
              setDraftAmount(next);
            }}
            placeholder="5,000"
            disabled={noLimit}
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
          {QUICK_AMOUNTS.map((q) => {
            const active =
              !noLimit && Number(draftAmount) === q.usd;
            return (
              <button
                key={q.usd}
                type="button"
                onClick={() => {
                  setNoLimit(false);
                  setDraftAmount(String(q.usd));
                }}
                className={
                  "rounded-full border px-3 py-1 text-xs font-medium " +
                  "transition-colors duration-base ease-out-soft " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
                  (active
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
                }
              >
                {q.label}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              setNoLimit(true);
              setDraftAmount("");
            }}
            className={
              "rounded-full border px-3 py-1 text-xs font-medium " +
              "transition-colors duration-base ease-out-soft " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
              (noLimit
                ? "border-accent bg-accent/10 text-accent"
                : "border-border-soft bg-canvas text-text-soft hover:border-accent/40 hover:text-text-strong")
            }
          >
            No limit
          </button>
        </div>
      </div>

      <Button size="lg" fullWidth onClick={handleSave}>
        {noLimit
          ? "Remove the limit"
          : draftAmount
            ? `Set ${formatUsd(Number(draftAmount) || 0)}/week`
            : "Save"}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </Button>

      <p className="text-center text-xs text-text-soft">
        <strong className="text-text-strong">Heads up:</strong> we&rsquo;re
        showing this against demo prices ({formatUsd(quotePerWhole("SOL")?.usdPerWhole ?? 0)}{" "}
        / SOL etc.) and the cap is a nudge today — wallet approvals
        still rule. Real on-chain enforcement lands when the policy
        program ships the field.
      </p>
    </div>
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

  const { spentUsd, proposalCount, remainingUsd, pctUsed, budget } = usage;
  const cap = budget?.weeklyUsd ?? null;
  const noBudget = cap === null || cap === undefined;

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
          {proposalCount} {proposalCount === 1 ? "send" : "sends"}
        </span>
      </div>
      {!noBudget && cap > 0 && pctUsed !== null && (
        <>
          <div
            className="mt-3 h-2 overflow-hidden rounded-full bg-border-soft"
            role="progressbar"
            aria-valuenow={Math.round(pctUsed * 100)}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              style={{ width: `${Math.round(pctUsed * 100)}%` }}
              className={
                "h-full transition-[width] duration-base ease-out-soft " +
                (pctUsed >= 1
                  ? "bg-danger"
                  : pctUsed >= 0.8
                    ? "bg-warning"
                    : "bg-accent")
              }
            />
          </div>
          <p className="mt-2 text-xs text-text-soft">
            {remainingUsd !== null && remainingUsd >= 0
              ? `${formatUsd(remainingUsd)} left of ${formatUsd(cap)}`
              : `${formatUsd(Math.abs(remainingUsd ?? 0))} over the ${formatUsd(cap)} cap`}
          </p>
        </>
      )}
      {noBudget && (
        <p className="mt-2 text-xs text-text-soft">
          No cap set yet — pick one below to start tracking.
        </p>
      )}
    </div>
  );
}

export type { WalletBudget };
