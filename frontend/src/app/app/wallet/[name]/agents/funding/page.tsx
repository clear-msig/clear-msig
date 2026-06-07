"use client";

import { useMemo } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock,
  type LucideIcon,
  Play,
  TrendingUp,
  Trophy,
} from "lucide-react";
import {
  agentLeaderboard,
  buildAgentFundingPlan,
  getAgentVaultPolicy,
  listAgentScorecards,
  listAgentSessions,
  listAgents,
  type AgentFundingRecommendation,
} from "@/lib/agents";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function AgentFundingPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const policy = getAgentVaultPolicy(name);
  const plan = buildAgentFundingPlan({
    agents: listAgents(name),
    scorecards: listAgentScorecards(name),
    leaderboard: agentLeaderboard(name),
    sessions: listAgentSessions(name),
    policy,
  });
  const topAction = plan.recommendations.find((item) =>
    ["raise", "fund", "lower"].includes(item.action),
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Funding · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Fund traders by performance
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              ClearSig recommends small, time-boxed practice allowances from
              each trader&apos;s results and your safety rules. You approve
              every allowance before it can trade.
            </p>
          </div>
          {topAction ? (
            <Link href={fundingHref(encoded, topAction)} className={PRIMARY_BUTTON}>
              <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
              {topAction.ctaLabel}
            </Link>
          ) : (
            <Link
              href={`/app/wallet/${encoded}/agents/library`}
              className={PRIMARY_BUTTON}
            >
              <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
              Choose trader
            </Link>
          )}
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric
          label="Traders reviewed"
          value={String(plan.recommendations.length)}
          Icon={Trophy}
        />
        <Metric
          label="Active allowances"
          value={String(plan.activeAllowances)}
          Icon={Clock}
        />
        <Metric
          label="Ready to raise"
          value={String(plan.raiseCount)}
          Icon={TrendingUp}
          highlight={plan.raiseCount > 0}
        />
        <Metric
          label="Suggested room"
          value={formatUsd(plan.totalRecommendedNotionalUsd)}
          Icon={CircleDollarSign}
        />
      </section>

      {policy.emergencyPaused || !policy.enabled ? (
        <section className="rounded-card border border-warning/30 bg-warning/[0.08] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-text-strong">
                Funding is in review mode
              </p>
              <p className="mt-1 text-sm leading-relaxed text-text-soft">
                Turn on safety rules and make sure the kill switch is off before
                giving a trader a new allowance.
              </p>
            </div>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3">
        {plan.recommendations.length > 0 ? (
          plan.recommendations.map((item) => (
            <FundingCard key={item.agent.id} item={item} walletEncoded={encoded} />
          ))
        ) : (
          <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-6">
            <p className="text-sm font-semibold text-text-strong">
              No traders to fund yet
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              Choose a prepared trader or create your own, then ClearSig can
              recommend a small practice allowance.
            </p>
            <Link
              href={`/app/wallet/${encoded}/agents/library`}
              className="mt-4 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
            >
              Open Agent Library
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}

function FundingCard({
  item,
  walletEncoded,
}: {
  item: AgentFundingRecommendation;
  walletEncoded: string;
}) {
  const statusTone = actionTone(item.action);
  const active = Boolean(item.currentSession);
  return (
    <article className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span className={clsx("flex h-10 w-10 shrink-0 items-center justify-center rounded-full", statusTone.icon)}>
            {item.action === "raise" ? (
              <TrendingUp className="h-4 w-4" aria-hidden="true" />
            ) : item.action === "lower" || item.action === "review" ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <CircleDollarSign className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                {item.agent.name}
              </h2>
              <span className={clsx("rounded-full border px-2 py-0.5 text-[10px] font-medium", statusTone.badge)}>
                {item.headline}
              </span>
              {active ? (
                <span className="rounded-full border border-accent/30 bg-accent/[0.08] px-2 py-0.5 text-[10px] font-medium text-accent">
                  Active now
                </span>
              ) : null}
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              {item.summary}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={fundingHref(walletEncoded, item)} className={PRIMARY_BUTTON}>
            {item.action === "keep" && active ? (
              <Play className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <CircleDollarSign className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {item.ctaLabel}
          </Link>
          <Link
            href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(item.agent.id)}`}
            className={SECONDARY_BUTTON}
          >
            Details
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MiniMetric label="Level" value={item.allocation.tier.label} />
        <MiniMetric
          label="Trade size"
          value={formatUsd(item.allocation.limits.maxNotionalUsd)}
        />
        <MiniMetric
          label="Leverage"
          value={`${item.allocation.limits.maxLeverage}x max`}
        />
        <MiniMetric
          label="Open trades"
          value={String(item.allocation.limits.maxOpenPositions)}
        />
        <MiniMetric
          label="Window"
          value={`${item.allocation.limits.sessionHours}h`}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="text-xs font-semibold text-text-strong">
            Why this recommendation?
          </p>
          <ul className="mt-2 grid gap-1.5">
            {item.allocation.reasons.slice(0, 4).map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-xs leading-relaxed text-text-soft">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                <span>{plainMetric(reason)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-soft border border-border-soft bg-canvas p-3">
          <p className="text-xs font-semibold text-text-strong">
            Next level
          </p>
          {item.allocation.nextTier ? (
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {item.allocation.nextTier.label} needs{" "}
              {item.allocation.nextTierGaps.length > 0
                ? item.allocation.nextTierGaps.slice(0, 3).join(", ")
                : "continued clean trading"}.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              This trader is already at the highest practice funding level.
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function fundingHref(
  walletEncoded: string,
  item: AgentFundingRecommendation,
): string {
  if (item.action === "keep" && item.currentSession) {
    const venue = item.currentSession.allowedVenues?.[0] ?? "mock_perps";
    return `/app/wallet/${walletEncoded}/agents/start?agent=${encodeURIComponent(item.agent.id)}&venue=${encodeURIComponent(venue)}`;
  }
  const venue = item.allocation.limits.allowedVenues[0] ?? "mock_perps";
  const query = new URLSearchParams({
    agent: item.agent.id,
    allocationTier: item.allocation.tier.id,
    venue,
    amount: item.allocation.limits.maxNotionalUsd,
    leverage: String(item.allocation.limits.maxLeverage),
  });
  return `/app/wallet/${walletEncoded}/agents/sessions/new?${query.toString()}`;
}

function Metric({
  label,
  value,
  Icon,
  highlight = false,
}: {
  label: string;
  value: string;
  Icon: LucideIcon;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-soft">
          {label}
        </p>
        <Icon className={clsx("h-3.5 w-3.5", highlight ? "text-accent" : "text-text-muted")} aria-hidden="true" />
      </div>
      <p className={clsx("mt-2 text-lg font-semibold", highlight ? "text-accent" : "text-text-strong")}>
        {value}
      </p>
    </div>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 break-words text-xs font-semibold text-text-strong">
        {value}
      </p>
    </div>
  );
}

function actionTone(action: AgentFundingRecommendation["action"]) {
  switch (action) {
    case "raise":
      return {
        icon: "bg-accent/10 text-accent",
        badge: "border-accent/30 bg-accent/[0.08] text-accent",
      };
    case "lower":
      return {
        icon: "bg-rose-500/[0.12] text-rose-300",
        badge: "border-rose-500/30 bg-rose-500/[0.08] text-rose-300",
      };
    case "review":
      return {
        icon: "bg-warning/[0.12] text-warning",
        badge: "border-warning/30 bg-warning/[0.08] text-warning",
      };
    case "fund":
    case "keep":
      return {
        icon: "bg-accent/10 text-accent",
        badge: "border-border-soft bg-canvas text-text-soft",
      };
  }
}

function plainMetric(value: string): string {
  return value
    .replace("executed trades", "completed trades")
    .replace("trust score", "trust score")
    .replace("maximum drawdown", "largest drop")
    .replace("violation rate", "safety stop rate");
}

function decodeParam(value: string | undefined): string {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

const PRIMARY_BUTTON = clsx(
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-semibold text-text-on-accent",
  "transition-colors hover:bg-accent-strong",
);

const SECONDARY_BUTTON = clsx(
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong",
  "transition-colors hover:border-accent/60 hover:text-accent",
);
