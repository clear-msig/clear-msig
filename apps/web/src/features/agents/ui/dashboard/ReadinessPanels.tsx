"use client";

import clsx from "clsx";
import { Check, TrendingUp } from "lucide-react";
import { estimateAgentOpenTradePerformance, type AgentAutomaticExitDecision, type AgentExecutionRecord, type AgentMarketDataSnapshot } from "@/features/agents/domain";
import { formatSignedUsd } from "@/features/agents/ui/dashboard/MetaPanels";
import { ExecutionCard } from "@/features/agents/ui/dashboard/ProposalPanels";

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
