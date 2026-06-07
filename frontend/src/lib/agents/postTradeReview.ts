import type {
  AgentExecutionRecord,
  AgentPostTradeReview,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface BuildAgentPostTradeReviewInput {
  execution: AgentExecutionRecord;
  proposal?: AgentTradeProposal | null;
  realizedPnlUsd: string;
  now?: number;
}

export function buildAgentPostTradeReview({
  execution,
  proposal,
  realizedPnlUsd,
  now = Date.now(),
}: BuildAgentPostTradeReviewInput): AgentPostTradeReview {
  const pnl = numberValue(realizedPnlUsd);
  const outcome = pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat";
  const thesisVerdict =
    outcome === "win" ? "confirmed" : outcome === "loss" ? "invalidated" : "inconclusive";
  const journal = proposal?.decisionJournal;
  return {
    outcome,
    thesisVerdict,
    summary: reviewSummary({ execution, proposal, pnl, outcome, thesisVerdict }),
    lesson: reviewLesson({ outcome, proposal }),
    riskReview: reviewRisk({ execution, proposal, pnl }),
    realizedPnlUsd: String(roundMoney(pnl)),
    reviewedAt: now,
    version: 1,
  };
}

function reviewSummary({
  execution,
  proposal,
  pnl,
  outcome,
  thesisVerdict,
}: {
  execution: AgentExecutionRecord;
  proposal?: AgentTradeProposal | null;
  pnl: number;
  outcome: AgentPostTradeReview["outcome"];
  thesisVerdict: AgentPostTradeReview["thesisVerdict"];
}): string {
  const thesis = proposal?.decisionJournal?.summary ?? proposal?.thesis;
  const base = `${execution.market} ${execution.side} closed ${outcomeLabel(outcome)} at ${formatSignedUsd(pnl)}.`;
  if (!thesis) return `${base} The thesis was ${verdictLabel(thesisVerdict)}.`;
  return `${base} Thesis review: ${truncate(thesis, 180)} The thesis was ${verdictLabel(thesisVerdict)}.`;
}

function reviewLesson({
  outcome,
  proposal,
}: {
  outcome: AgentPostTradeReview["outcome"];
  proposal?: AgentTradeProposal | null;
}): string {
  if (outcome === "win") {
    return "Keep tracking whether this setup repeats without increasing risk too quickly.";
  }
  if (outcome === "loss") {
    return proposal?.decisionJournal?.invalidation
      ? `The invalidation mattered: ${proposal.decisionJournal.invalidation}`
      : "Review whether entry timing, stop placement, or market context was too weak.";
  }
  return "Flat result. Require clearer evidence before giving this setup more room.";
}

function reviewRisk({
  execution,
  proposal,
  pnl,
}: {
  execution: AgentExecutionRecord;
  proposal?: AgentTradeProposal | null;
  pnl: number;
}): string {
  const size = numberValue(execution.notionalUsd);
  const pct = size > 0 ? (pnl / size) * 100 : 0;
  const plannedRisk = proposal?.decisionJournal?.riskPlan;
  const result = `Realized ${formatNumber(pct)}% on ${formatUsd(size)} notional at ${execution.leverage}x.`;
  return plannedRisk ? `${result} Planned risk: ${plannedRisk}` : result;
}

function outcomeLabel(outcome: AgentPostTradeReview["outcome"]): string {
  if (outcome === "win") return "profitably";
  if (outcome === "loss") return "at a loss";
  return "flat";
}

function verdictLabel(verdict: AgentPostTradeReview["thesisVerdict"]): string {
  if (verdict === "confirmed") return "supported by the result";
  if (verdict === "invalidated") return "not supported by the result";
  return "inconclusive";
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}${formatUsd(Math.abs(value))}`;
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
