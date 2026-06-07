import type { AgentMarketDataSnapshot } from "@/lib/agents/marketData";
import { estimateAgentOpenTradePerformance } from "@/lib/agents/marketData";
import type {
  AgentExecutionRecord,
  AgentTradeProposal,
} from "@/lib/agents/types";

export type AgentAutomaticExitReason = "take_profit" | "stop_loss";

export interface AgentAutomaticExitDecision {
  execution: AgentExecutionRecord;
  proposal?: AgentTradeProposal;
  snapshot: AgentMarketDataSnapshot;
  reason: AgentAutomaticExitReason;
  realizedPnlUsd: string;
  summary: string;
}

export function buildAgentAutomaticExitDecisions({
  executions,
  proposals,
  marketByMarket,
}: {
  executions: AgentExecutionRecord[];
  proposals: AgentTradeProposal[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
}): AgentAutomaticExitDecision[] {
  const decisions: AgentAutomaticExitDecision[] = [];
  for (const execution of executions) {
    if (execution.status !== "open") continue;
    const proposal = proposals.find((item) => item.id === execution.proposalId);
    const snapshot = marketByMarket[execution.market.trim().toUpperCase()];
    if (!snapshot) continue;
    const reason = automaticExitReason(execution, proposal, snapshot);
    if (!reason) continue;
    const performance = estimateAgentOpenTradePerformance(execution, snapshot);
    decisions.push({
      execution,
      proposal,
      snapshot,
      reason,
      realizedPnlUsd: performance?.unrealizedPnlUsd ?? "0",
      summary: automaticExitSummary({ execution, snapshot, reason }),
    });
  }
  return decisions;
}

function automaticExitReason(
  execution: AgentExecutionRecord,
  proposal: AgentTradeProposal | undefined,
  snapshot: AgentMarketDataSnapshot,
): AgentAutomaticExitReason | null {
  const mark = Number(snapshot.markPriceUsd);
  if (!Number.isFinite(mark) || mark <= 0) return null;
  const stop = positiveNumber(proposal?.stopLossPrice);
  const target = positiveNumber(proposal?.takeProfitPrice);
  if (execution.side === "long") {
    if (target != null && mark >= target) return "take_profit";
    if (stop != null && mark <= stop) return "stop_loss";
    return null;
  }
  if (target != null && mark <= target) return "take_profit";
  if (stop != null && mark >= stop) return "stop_loss";
  return null;
}

function automaticExitSummary({
  execution,
  snapshot,
  reason,
}: {
  execution: AgentExecutionRecord;
  snapshot: AgentMarketDataSnapshot;
  reason: AgentAutomaticExitReason;
}): string {
  const label = reason === "take_profit" ? "take profit" : "stop loss";
  return `${execution.market} ${execution.side} reached its ${label} condition at ${formatUsd(snapshot.markPriceUsd)}.`;
}

function positiveNumber(value: string | number | null | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function formatUsd(value: string | number): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
