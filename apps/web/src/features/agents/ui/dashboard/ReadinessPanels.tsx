"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowRight, AlertTriangle, Check, Database, ShieldCheck, TrendingUp } from "lucide-react";
import { estimateAgentOpenTradePerformance, type AgentAutomaticExitDecision, type AgentExecutionRecord, type AgentMarketDataSnapshot, type AgentMarketReadiness, type AgentBetaReadiness } from "@/features/agents/domain";
import { formatSignedUsd } from "@/features/agents/ui/dashboard/MetaPanels";
import { ExecutionCard } from "@/features/agents/ui/dashboard/ProposalPanels";

type BackendPersistenceStatus = {
  state: "checking" | "synced" | "local";
  storage?: "redis" | "memory";
  agents: number;
  proposals: number;
  sessions: number;
  events: number;
  message: string;
  updatedAt?: number;
};

export function BackendPersistencePanel({
  status,
}: {
  status: BackendPersistenceStatus;
}) {
  const synced = status.state === "synced";
  const checking = status.state === "checking";
  const title = checking
    ? "Checking saved changes"
    : synced
      ? "Changes are saved"
      : "Saved on this device";
  const summary = checking
    ? "Making sure your latest changes are available."
    : synced
      ? "Your traders, ideas, budgets, and history are saved."
      : "You can keep working here. Wider access will return when saving reconnects.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              synced ? "bg-accent/10 text-accent" : "bg-warning/[0.08] text-warning",
            )}
          >
            <Database className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Saving
            </h2>
            <p className="mt-0.5 text-xs font-medium text-text-soft">
              {title}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              {summary}
            </p>
            {synced ? (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-soft">
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.agents} traders
                </span>
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.proposals} ideas
                </span>
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.sessions} budgets
                </span>
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.events} updates
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            synced
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : "border-warning/30 bg-warning/[0.08] text-warning",
          )}
          title={
            status.updatedAt
              ? new Date(status.updatedAt).toLocaleString()
              : undefined
          }
        >
          {checking ? "Checking" : synced ? "Saved" : "This device"}
        </span>
      </div>
    </section>
  );
}
export function BetaReadinessPanel({
  readiness,
}: {
  readiness: AgentBetaReadiness;
}) {
  const ready = readiness.status === "ready";
  const blocked = readiness.status === "blocked";
  const topChecks = readiness.checks
    .filter((check) => check.status !== "pass")
    .slice(0, 4);
  const visibleChecks =
    topChecks.length > 0 ? topChecks : readiness.checks.slice(0, 4);
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest",
        ready
          ? "border-accent/30 bg-accent/[0.06]"
          : blocked
            ? "border-rose-500/30 bg-rose-500/[0.08]"
            : "border-warning/30 bg-warning/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              ready
                ? "bg-accent/10 text-accent"
                : blocked
                  ? "bg-rose-500/[0.12] text-rose-300"
                  : "bg-warning/[0.12] text-warning",
            )}
          >
            {ready ? (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Developer readiness
              </h2>
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  ready
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : blocked
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {readiness.score}% · {readiness.headline}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              {readiness.summary}
            </p>
          </div>
        </div>
        <Link
          href={topChecks[0]?.href ?? readiness.checks[0]?.href ?? "#"}
          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          Review
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {visibleChecks.map((check) => (
          <div
            key={check.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  check.status === "pass"
                    ? "bg-accent"
                    : check.status === "block"
                      ? "bg-rose-400"
                      : "bg-warning",
                )}
              />
              <p className="text-xs font-semibold text-text-strong">
                {check.label}
              </p>
              {check.href ? (
                <Link
                  href={check.href}
                  className="text-[11px] font-medium text-accent hover:text-accent-hover"
                >
                  Open
                </Link>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {check.message}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
export function MarketReadinessPanel({
  readiness,
}: {
  readiness: AgentMarketReadiness;
}) {
  const blockers = readiness.checks
    .filter((check) => check.status === "block")
    .slice(0, 5);
  const nextChecks =
    blockers.length > 0
      ? blockers
      : readiness.checks.filter((check) => check.status === "todo").slice(0, 5);

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              readiness.status === "ready"
                ? "bg-accent/10 text-accent"
                : readiness.status === "blocked"
                  ? "bg-rose-500/[0.12] text-rose-300"
                  : "bg-warning/[0.12] text-warning",
            )}
          >
            {readiness.status === "ready" ? (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Database className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Market readiness
              </h2>
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  readiness.status === "ready"
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : readiness.status === "blocked"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {readiness.score}% · {readiness.headline}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              {readiness.summary}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {readiness.phases.map((phase) => (
          <div
            key={phase.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-strong">
                {phase.label}
              </p>
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  phase.status === "ready"
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : phase.status === "blocked"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {phase.score}%
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {phase.summary}
            </p>
          </div>
        ))}
      </div>

      {nextChecks.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {nextChecks.map((check) => (
            <div
              key={check.id}
              className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    check.status === "block" ? "bg-rose-400" : "bg-warning",
                  )}
                />
                <p className="text-xs font-semibold text-text-strong">
                  {check.label}
                </p>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {check.category}
                </span>
                {check.href ? (
                  <Link
                    href={check.href}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent-hover"
                  >
                    Open
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">
                {check.message}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
export function OpenTradeMonitor({
  executions,
  marketByMarket,
  automaticExits,
  pending,
  onClose,
  onCloseAutomaticExits,
}: {
  executions: AgentExecutionRecord[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  automaticExits: AgentAutomaticExitDecision[];
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
  onCloseAutomaticExits: () => void;
}) {
  const estimates = executions
    .map((execution) => ({
      execution,
      performance: estimateAgentOpenTradePerformance(
        execution,
        marketByMarket[execution.market.trim().toUpperCase()] ?? null,
      ),
    }))
    .filter((item) => item.performance);
  const estimatedPnl = estimates.reduce(
    (sum, item) => sum + Number(item.performance?.unrealizedPnlUsd ?? 0),
    0,
  );
  const pricedCount = estimates.length;

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Open trade performance
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-soft">
              {pricedCount > 0
                ? `${pricedCount} of ${executions.length} open practice trade${executions.length === 1 ? "" : "s"} have a fresh mark. Estimated open P/L is ${formatSignedUsd(String(estimatedPnl))}.`
                : "Waiting for a market mark before estimating open practice P/L."}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            estimatedPnl > 0
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : estimatedPnl < 0
                ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                : "border-border-soft bg-canvas text-text-soft",
          )}
        >
          {formatSignedUsd(String(estimatedPnl))}
        </span>
      </div>
      {automaticExits.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-soft border border-accent/25 bg-accent/[0.06] px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-strong">
              Automatic exit ready
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-soft">
              {automaticExits[0]?.summary}
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={onCloseAutomaticExits}
            className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft bg-accent px-2.5 py-1.5 text-[11px] font-medium text-text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Close automatically
          </button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {executions.slice(0, 4).map((execution) => (
          <ExecutionCard
            key={execution.id}
            execution={execution}
            marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
            pending={pending}
            onClose={onClose}
          />
        ))}
      </div>
    </section>
  );
}
