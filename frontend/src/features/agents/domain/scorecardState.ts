import type {
  AgentExecutionRecord,
  AgentProfile,
  AgentScorecard,
  AgentTradeProposal,
} from "@/lib/agents/types";

type ScorecardOwner = Pick<AgentProfile, "walletName" | "id"> | {
  walletName: string;
  agentId: string;
};

export function blankAgentScorecard(
  owner: ScorecardOwner,
  now: number,
): AgentScorecard {
  return {
    walletName: owner.walletName,
    agentId: "agentId" in owner ? owner.agentId : owner.id,
    proposals: 0,
    approved: 0,
    rejected: 0,
    blocked: 0,
    executed: 0,
    ruleViolations: 0,
    realizedPnlUsd: "0",
    maxDrawdownPct: 0,
    humanOverrideCount: 0,
    updatedAt: now,
    version: 1,
  };
}

export function scorecardForNewProposal(
  current: AgentScorecard | undefined,
  proposal: AgentTradeProposal,
  now: number,
): AgentScorecard {
  const scorecard = {
    ...(current ?? blankAgentScorecard(proposal, now)),
  };
  scorecard.proposals += 1;
  scorecard.ruleViolations += proposal.policyViolations?.length ?? 0;
  incrementStatus(scorecard, proposal.status);
  scorecard.updatedAt = now;
  return scorecard;
}

export function scorecardForStatusChange(
  current: AgentScorecard | undefined,
  before: AgentTradeProposal,
  after: AgentTradeProposal,
  now: number,
  countPolicyViolations = false,
): AgentScorecard {
  const scorecard = {
    ...(current ?? blankAgentScorecard(after, now)),
  };
  if (before.status !== "approved" && after.status === "approved") {
    scorecard.approved += 1;
    if (before.status === "needs_approval") scorecard.humanOverrideCount += 1;
  }
  if (before.status !== "rejected" && after.status === "rejected") {
    scorecard.rejected += 1;
  }
  if (before.status !== "blocked" && after.status === "blocked") {
    scorecard.blocked += 1;
  }
  if (before.status !== "executed" && after.status === "executed") {
    scorecard.executed += 1;
  }
  if (countPolicyViolations) {
    scorecard.ruleViolations += after.policyViolations?.length ?? 0;
  }
  scorecard.updatedAt = now;
  return scorecard;
}

export function scorecardForClosedExecution(
  current: AgentScorecard | undefined,
  execution: AgentExecutionRecord,
  now: number,
): AgentScorecard {
  const scorecard = {
    ...(current ?? blankAgentScorecard(execution, now)),
  };
  const pnl = Number(execution.realizedPnlUsd || 0);
  const currentPnl = Number(scorecard.realizedPnlUsd || 0);
  const nextPnl = roundMoney(currentPnl + (Number.isFinite(pnl) ? pnl : 0));
  scorecard.realizedPnlUsd = String(nextPnl);
  if (nextPnl < 0) {
    const notional = Number(execution.notionalUsd || 0);
    if (Number.isFinite(notional) && notional > 0) {
      scorecard.maxDrawdownPct = Math.max(
        scorecard.maxDrawdownPct,
        roundMoney((Math.abs(nextPnl) / notional) * 100),
      );
    }
  }
  scorecard.updatedAt = now;
  return scorecard;
}

function incrementStatus(
  scorecard: AgentScorecard,
  status: AgentTradeProposal["status"],
): void {
  if (status === "approved") scorecard.approved += 1;
  if (status === "rejected") scorecard.rejected += 1;
  if (status === "blocked") scorecard.blocked += 1;
  if (status === "executed") {
    scorecard.executed += 1;
    scorecard.approved += 1;
  }
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
