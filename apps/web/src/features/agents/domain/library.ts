import type {
  AgentLeaderboardEntry,
  AgentProfile,
  AgentScorecard,
  AgentSessionGrant,
  TradingVenue,
} from "@/features/agents/domain/runtime";

export function librarySort(
  left: {
    agent: AgentProfile;
    scorecard?: AgentScorecard;
    leaderboard?: AgentLeaderboardEntry;
  },
  right: {
    agent: AgentProfile;
    scorecard?: AgentScorecard;
    leaderboard?: AgentLeaderboardEntry;
  },
): number {
  const activeDelta = statusWeight(right.agent.status) - statusWeight(left.agent.status);
  if (activeDelta !== 0) return activeDelta;
  const scoreDelta =
    (right.leaderboard?.score ?? 50) - (left.leaderboard?.score ?? 50);
  if (scoreDelta !== 0) return scoreDelta;
  const tradesDelta =
    (right.scorecard?.executed ?? 0) - (left.scorecard?.executed ?? 0);
  if (tradesDelta !== 0) return tradesDelta;
  return left.agent.name.localeCompare(right.agent.name);
}

export function agentMarkets(
  agent: AgentProfile,
  executions: Array<{ agentId: string; market: string }>,
): string[] {
  const values = [
    ...(agent.strategy?.allowedMarkets ?? []),
    ...executions
      .filter((execution) => execution.agentId === agent.id)
      .map((execution) => execution.market),
  ];
  return Array.from(
    new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)),
  );
}

export function sessionAllowsVenue(
  session: AgentSessionGrant,
  venue: TradingVenue,
  policy: { allowedVenues: TradingVenue[] },
): boolean {
  return session.allowedVenues?.length
    ? session.allowedVenues.includes(venue)
    : policy.allowedVenues.includes(venue);
}

export function currentSessionVenue(
  session: AgentSessionGrant | undefined,
): TradingVenue {
  return session?.allowedVenues?.[0] ?? "mock_perps";
}

function statusWeight(status: AgentProfile["status"]): number {
  if (status === "active") return 3;
  if (status === "paused") return 2;
  return 1;
}
