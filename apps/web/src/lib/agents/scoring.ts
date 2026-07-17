import type {
  AgentLeaderboardEntry,
  AgentScorecard,
} from "@/lib/agents/types";

export function scoreAgent(scorecard: AgentScorecard): AgentLeaderboardEntry {
  const pnl = parseDecimal(scorecard.realizedPnlUsd);
  const returnScore = clamp(50 + pnl / 20, 0, 100);
  const complianceScore =
    scorecard.proposals === 0
      ? 50
      : clamp(100 - (scorecard.ruleViolations / scorecard.proposals) * 100, 0, 100);
  const drawdownScore = clamp(100 - scorecard.maxDrawdownPct * 4, 0, 100);
  const executionScore =
    scorecard.approved === 0
      ? 50
      : clamp((scorecard.executed / scorecard.approved) * 100, 0, 100);
  const trustPenalty = clamp(scorecard.humanOverrideCount * 8, 0, 40);

  const score = clamp(
    returnScore * 0.3 +
      complianceScore * 0.3 +
      drawdownScore * 0.25 +
      executionScore * 0.15 -
      trustPenalty,
    0,
    100,
  );

  return {
    agentId: scorecard.agentId,
    walletName: scorecard.walletName,
    score: round(score),
    rankInputs: {
      returnScore: round(returnScore),
      complianceScore: round(complianceScore),
      drawdownScore: round(drawdownScore),
      executionScore: round(executionScore),
      trustPenalty: round(trustPenalty),
    },
  };
}

export function rankAgents(scorecards: AgentScorecard[]): AgentLeaderboardEntry[] {
  return scorecards
    .map(scoreAgent)
    .sort((a, b) => b.score - a.score || a.agentId.localeCompare(b.agentId));
}

function parseDecimal(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
