"use client";

import clsx from "clsx";
import { AlertTriangle, Clock, RefreshCw, ShieldCheck, Trophy, X } from "lucide-react";
import { type AgentAllocationRecommendation, type AgentExecutionRecord, type AgentLeaderboardEntry, type AgentMarketDataSnapshot, type AgentScorecard, type AgentTradeProposal } from "@/features/agents/domain";
import { Panel } from "@/features/agents/ui/detail/OverviewPanels";
import { formatNumber, plainMetricText } from "@/features/agents/ui/detail/presentation";
import { Badge, EmptyLine, ExecutionRow } from "@/features/agents/ui/detail/EntityRows";

export function ScoreBreakdownPanel({
  leaderboard,
}: {
  leaderboard?: AgentLeaderboardEntry;
}) {
  const inputs = leaderboard?.rankInputs;
  const rows = [
    { label: "Profit score", value: inputs?.returnScore ?? 50 },
    { label: "Safety score", value: inputs?.complianceScore ?? 50 },
    { label: "Largest fall score", value: inputs?.drawdownScore ?? 50 },
    { label: "Follow-through score", value: inputs?.executionScore ?? 50 },
    { label: "Manual change penalty", value: inputs?.trustPenalty ?? 0 },
  ];
  return (
    <Panel title="Score Breakdown" Icon={Trophy}>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-text-soft">{row.label}</span>
              <span className="font-semibold text-text-strong">{formatNumber(row.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div
                className={clsx(
                  "h-full rounded-full",
                  row.label.includes("penalty") ? "bg-warning" : "bg-accent",
                )}
                style={{ width: `${Math.min(100, Math.max(0, row.value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}
export function NextAllowancePanel({
  recommendation,
  scorecard,
  blockedProposals,
}: {
  recommendation: AgentAllocationRecommendation | null;
  scorecard?: AgentScorecard;
  blockedProposals: AgentTradeProposal[];
}) {
  const gaps = recommendation?.nextTierGaps ?? [];
  const suggestions = gaps.length > 0 ? gaps.map(plainMetricText) : [];
  if ((scorecard?.blocked ?? 0) > 0) {
    suggestions.push("Fewer stopped ideas will make the next budget easier to approve.");
  }
  if ((scorecard?.executed ?? 0) === 0) {
    suggestions.push("Complete a few small guarded trades first.");
  }
  return (
    <Panel title="Next Budget" Icon={ShieldCheck}>
      {recommendation?.nextTier ? (
        <p className="text-sm text-text-soft">
          Next level:{" "}
          <span className="font-semibold text-text-strong">
            {recommendation.nextTier.label}
          </span>
        </p>
      ) : (
        <p className="text-sm text-text-soft">
          Highest budget level.
        </p>
      )}
      <div className="mt-3 grid gap-2">
        {suggestions.length > 0 ? (
          suggestions.slice(0, 5).map((item) => (
            <div
              key={item}
              className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs leading-relaxed text-text-soft"
            >
              {item}
            </div>
          ))
        ) : (
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs text-text-soft">
            Keep the same performance while trading a little longer.
          </div>
        )}
      </div>
      {blockedProposals[0] ? (
        <p className="mt-3 text-xs leading-relaxed text-text-soft">
          Latest stopped idea: {blockedProposals[0].market} {blockedProposals[0].side}
          {blockedProposals[0].policyViolations?.[0]?.message
            ? ` â€” ${blockedProposals[0].policyViolations[0].message}`
            : ""}
        </p>
      ) : null}
    </Panel>
  );
}
export function RecentTradesPanel({
  executions,
  marketByMarket,
  pending,
  onClose,
}: {
  executions: AgentExecutionRecord[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
}) {
  return (
    <Panel title="Recent Trade History" Icon={Clock}>
      <div className="grid gap-2">
        {executions.length > 0 ? (
          executions.slice(0, 4).map((execution) => (
            <ExecutionRow
              key={execution.id}
              execution={execution}
              marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
              pending={pending}
              onClose={onClose}
            />
          ))
        ) : (
          <EmptyLine text="No trades yet." />
        )}
      </div>
    </Panel>
  );
}
export function StoppedIdeasPanel({
  proposals,
}: {
  proposals: AgentTradeProposal[];
}) {
  return (
    <Panel title="Stopped Ideas" Icon={AlertTriangle}>
      <div className="grid gap-2">
        {proposals.length > 0 ? (
          proposals.slice(0, 4).map((proposal) => (
            <div
              key={proposal.id}
              className="rounded-soft border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text-strong">
                  {proposal.market} · {proposal.side}
                </p>
                <Badge tone="danger">Stopped</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">
                {proposal.policyViolations?.[0]?.message ??
                  "This idea was outside the current budget."}
              </p>
            </div>
          ))
        ) : (
          <EmptyLine text="No stopped ideas yet." />
        )}
      </div>
    </Panel>
  );
}
export function KillSwitchPanel({
  paused,
  pending,
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <section
      className={clsx(
        "rounded-card p-4 shadow-card-rest",
        paused
          ? "border-rose-500/30 bg-rose-500/[0.08]"
          : "border-border-soft bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              paused ? "bg-rose-500/[0.12] text-rose-300" : "bg-accent/10 text-accent",
            )}
          >
            {paused ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-strong">
              {paused ? "Agent Trading is paused" : "Agent Trading is armed"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              {paused
                ? "The kill switch is on. New agent signals cannot open paper trades."
                : "Use the kill switch to stop all agent trading immediately."}
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(!paused)}
          className={clsx(
            "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border px-3 py-2 text-xs font-medium",
            "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            paused
              ? "border-accent/30 text-accent hover:bg-accent/[0.08]"
              : "border-rose-500/30 text-rose-300 hover:bg-rose-500/[0.08]",
          )}
        >
          {paused ? (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {paused ? "Resume agent trading" : "Pause all agents"}
        </button>
      </div>
    </section>
  );
}
export function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-soft">{label}</p>
      <p className="mt-1 break-words text-sm text-text-strong">{value}</p>
    </div>
  );
}
export function ScoreRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-xs font-medium text-text-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}
