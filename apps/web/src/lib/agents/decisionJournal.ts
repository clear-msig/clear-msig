import type { AgentMarketDataSnapshot } from "@/lib/agents/marketData";
import type {
  AgentPolicyEvaluation,
  AgentProfile,
  AgentTradeDecisionEvidence,
  AgentTradeDecisionJournal,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface AgentTradeDecisionJournalInput {
  agent: AgentProfile;
  proposal: AgentTradeProposal;
  evaluation: AgentPolicyEvaluation;
  marketData?: AgentMarketDataSnapshot | null;
  technicalSummary?: string;
  fundamentalSummary?: string;
  newsSummary?: string;
  riskPlan?: string;
  exitPlan?: string;
  invalidation?: string;
  now?: number;
}

export function buildAgentTradeDecisionJournal({
  agent,
  proposal,
  evaluation,
  marketData,
  technicalSummary,
  fundamentalSummary,
  newsSummary,
  riskPlan,
  exitPlan,
  invalidation,
  now = Date.now(),
}: AgentTradeDecisionJournalInput): AgentTradeDecisionJournal {
  const thesis = proposal.thesis?.trim();
  const side = proposal.side === "long" ? "long" : "short";
  const riskControls = [
    proposal.stopLossPrice ? `stop ${proposal.stopLossPrice}` : "no stop supplied",
    proposal.takeProfitPrice ? `target ${proposal.takeProfitPrice}` : "no target supplied",
    `${proposal.leverage}x leverage`,
    `${formatUsd(proposal.notionalUsd)} size`,
  ];
  const evidence = decisionEvidence({
    agent,
    proposal,
    marketData,
    technicalSummary,
    fundamentalSummary,
    newsSummary,
    riskPlan,
    now,
  });
  return {
    summary:
      thesis ||
      `${agent.name} prepared a ${side} ${proposal.market} idea and asked ClearSig to check it against the current allowance.`,
    entryReason:
      thesis ||
      `${proposal.market} ${side} setup fits the agent's current trading playbook and requested venue.`,
    technicalSummary: clean(technicalSummary),
    fundamentalSummary: clean(fundamentalSummary),
    newsSummary: clean(newsSummary),
    riskPlan:
      clean(riskPlan) ??
      `Risk is bounded by ${riskControls.join(", ")} and ClearSig policy checks.`,
    exitPlan:
      clean(exitPlan) ??
      agent.strategy?.exitRules ??
      "Exit when the target, stop, or trade thesis fails.",
    invalidation:
      clean(invalidation) ??
      (proposal.stopLossPrice
        ? `The idea is invalid if price reaches ${proposal.stopLossPrice}.`
        : "The idea is invalid if the setup no longer matches the trading plan."),
    policySummary: policySummary(evaluation),
    confidenceRationale: `${proposal.confidence}% confidence based on agent rules, submitted evidence, and ClearSig risk checks.`,
    evidence,
    createdAt: now,
    version: 1,
  };
}

function decisionEvidence({
  agent,
  proposal,
  marketData,
  technicalSummary,
  fundamentalSummary,
  newsSummary,
  riskPlan,
  now,
}: {
  agent: AgentProfile;
  proposal: AgentTradeProposal;
  marketData?: AgentMarketDataSnapshot | null;
  technicalSummary?: string;
  fundamentalSummary?: string;
  newsSummary?: string;
  riskPlan?: string;
  now: number;
}): AgentTradeDecisionEvidence[] {
  const evidence: AgentTradeDecisionEvidence[] = [];
  if (marketData) {
    evidence.push({
      id: "market-data",
      kind: "market_data",
      label: `${marketData.market} market data`,
      summary: `Mark price ${formatUsd(marketData.markPriceUsd)} from ${marketData.source === "live" ? "live public data" : "practice data"}.`,
      source: marketData.source,
      observedAt: marketData.observedAt,
    });
  }
  if (agent.strategy?.entryRules) {
    evidence.push({
      id: "strategy-entry",
      kind: "strategy",
      label: "Agent entry rules",
      summary: agent.strategy.entryRules,
      observedAt: now,
    });
  }
  addOptionalEvidence(evidence, "technical", "technical", "Technical read", technicalSummary, now);
  addOptionalEvidence(evidence, "fundamental", "fundamental", "Fundamental read", fundamentalSummary, now);
  addOptionalEvidence(evidence, "news", "news", "News and macro context", newsSummary, now);
  addOptionalEvidence(evidence, "risk", "risk", "Risk plan", riskPlan, now);
  evidence.push({
    id: "trade-shape",
    kind: "risk",
    label: "Trade shape",
    summary: `${proposal.side} ${proposal.market}, ${formatUsd(proposal.notionalUsd)}, ${proposal.leverage}x leverage.`,
    observedAt: now,
  });
  return evidence;
}

function addOptionalEvidence(
  evidence: AgentTradeDecisionEvidence[],
  id: string,
  kind: AgentTradeDecisionEvidence["kind"],
  label: string,
  summary: string | undefined,
  observedAt: number,
): void {
  const cleaned = clean(summary);
  if (!cleaned) return;
  evidence.push({ id, kind, label, summary: cleaned, observedAt });
}

function policySummary(evaluation: AgentPolicyEvaluation): string {
  if (evaluation.decision === "allowed") {
    return "ClearSig checks passed and the idea fits the current allowance.";
  }
  if (evaluation.decision === "requires_human_approval") {
    return "ClearSig checks require owner approval before this idea can trade.";
  }
  const first = evaluation.violations[0]?.message;
  return first
    ? `ClearSig stopped this idea: ${first}`
    : "ClearSig stopped this idea because it failed the current safety rules.";
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
