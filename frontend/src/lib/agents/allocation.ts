import type {
  AgentLeaderboardEntry,
  AgentAllocationTierId,
  AgentProfile,
  AgentScorecard,
  AgentSessionGrant,
  AgentVaultPolicy,
  TradingVenue,
} from "@/lib/agents/types";

export type AgentAllocationAction =
  | "start"
  | "hold"
  | "promote"
  | "demote"
  | "review";

export interface AgentAllocationTier {
  id: AgentAllocationTierId;
  label: string;
  maxNotionalUsd: string;
  maxLeverage: number;
  maxOpenPositions: number;
  sessionHours: number;
  minimumExecuted: number;
  minimumScore: number;
  maximumDrawdownPct: number;
  maximumViolationRatePct: number;
  maximumHumanOverrides: number;
  requiresPositivePnl: boolean;
}

export interface AgentAllocationLimits {
  tierId: AgentAllocationTierId;
  tierLabel: string;
  allowedVenues: TradingVenue[];
  allowedMarkets: string[];
  maxNotionalUsd: string;
  maxLeverage: number;
  maxOpenPositions: number;
  sessionHours: number;
}

export interface AgentAllocationRecommendation {
  agentId: string;
  action: AgentAllocationAction;
  tier: AgentAllocationTier;
  limits: AgentAllocationLimits;
  summary: string;
  reasons: string[];
  nextTier: AgentAllocationTier | null;
  nextTierGaps: string[];
}

export function boundAgentSessionToPolicy(
  session: AgentSessionGrant,
  policy: AgentVaultPolicy,
): AgentSessionGrant {
  const policyMarkets = policy.allowedMarkets.map(normalizeMarket);
  const requestedMarkets = session.allowedMarkets?.map(normalizeMarket);
  const allowedVenues = session.allowedVenues?.length
    ? policy.allowedVenues.filter((venue) => session.allowedVenues?.includes(venue))
    : [...policy.allowedVenues];
  const allowedMarkets = requestedMarkets?.length
    ? policyMarkets.filter((market) => requestedMarkets.includes(market))
    : policyMarkets;
  const maxSessionMs =
    policy.maxSessionHours > 0 ? policy.maxSessionHours * 60 * 60 * 1000 : null;

  return {
    ...session,
    allowedVenues,
    allowedMarkets,
    maxNotionalUsd: String(
      minPositive(Number(session.maxNotionalUsd), Number(policy.maxNotionalUsd)),
    ),
    maxLeverage: minPositive(session.maxLeverage ?? 1, policy.maxLeverage),
    maxOpenPositions: Math.floor(
      minPositive(session.maxOpenPositions ?? 1, policy.maxOpenPositionsPerAgent),
    ),
    expiresAt:
      maxSessionMs == null
        ? session.expiresAt
        : Math.min(session.expiresAt, session.startsAt + maxSessionMs),
  };
}

export const AGENT_ALLOCATION_TIERS: readonly AgentAllocationTier[] = [
  {
    id: "probation",
    label: "Probation",
    maxNotionalUsd: "250",
    maxLeverage: 1,
    maxOpenPositions: 1,
    sessionHours: 4,
    minimumExecuted: 0,
    minimumScore: 0,
    maximumDrawdownPct: 100,
    maximumViolationRatePct: 100,
    maximumHumanOverrides: Number.MAX_SAFE_INTEGER,
    requiresPositivePnl: false,
  },
  {
    id: "trusted",
    label: "Trusted",
    maxNotionalUsd: "500",
    maxLeverage: 2,
    maxOpenPositions: 2,
    sessionHours: 12,
    minimumExecuted: 20,
    minimumScore: 70,
    maximumDrawdownPct: 10,
    maximumViolationRatePct: 10,
    maximumHumanOverrides: 1,
    requiresPositivePnl: true,
  },
  {
    id: "proven",
    label: "Proven",
    maxNotionalUsd: "1000",
    maxLeverage: 2,
    maxOpenPositions: 3,
    sessionHours: 24,
    minimumExecuted: 50,
    minimumScore: 82,
    maximumDrawdownPct: 6,
    maximumViolationRatePct: 5,
    maximumHumanOverrides: 0,
    requiresPositivePnl: true,
  },
] as const;

export function agentAllocationTierById(
  tierId: string | null | undefined,
): AgentAllocationTier | null {
  return AGENT_ALLOCATION_TIERS.find((tier) => tier.id === tierId) ?? null;
}

export function agentAllocationLimits(
  tier: AgentAllocationTier,
  policy: AgentVaultPolicy,
): AgentAllocationLimits {
  return {
    tierId: tier.id,
    tierLabel: tier.label,
    allowedVenues: [...policy.allowedVenues],
    allowedMarkets: [...policy.allowedMarkets],
    maxNotionalUsd: String(
      minPositive(Number(tier.maxNotionalUsd), Number(policy.maxNotionalUsd)),
    ),
    maxLeverage: minPositive(tier.maxLeverage, policy.maxLeverage),
    maxOpenPositions: Math.floor(
      minPositive(tier.maxOpenPositions, policy.maxOpenPositionsPerAgent),
    ),
    sessionHours: minPositive(tier.sessionHours, policy.maxSessionHours),
  };
}

export function recommendAgentAllocation({
  agent,
  scorecard,
  leaderboard,
  currentSession,
  policy,
  now = Date.now(),
}: {
  agent: AgentProfile;
  scorecard?: AgentScorecard | null;
  leaderboard?: AgentLeaderboardEntry | null;
  currentSession?: AgentSessionGrant | null;
  policy: AgentVaultPolicy;
  now?: number;
}): AgentAllocationRecommendation {
  const metrics = allocationMetrics(scorecard, leaderboard);
  const eligible = AGENT_ALLOCATION_TIERS.filter(
    (tier) => tierGaps(tier, metrics).length === 0,
  );
  const tier = eligible[eligible.length - 1] ?? AGENT_ALLOCATION_TIERS[0];
  const limits = agentAllocationLimits(tier, policy);
  const nextTier = AGENT_ALLOCATION_TIERS[AGENT_ALLOCATION_TIERS.indexOf(tier) + 1] ?? null;
  const nextTierGaps = nextTier ? tierGaps(nextTier, metrics) : [];
  const authorityUnavailable =
    agent.status !== "active" || !policy.enabled || policy.emergencyPaused;
  const action = authorityUnavailable
    ? "review"
    : allocationAction(currentSession, limits, now);
  const reasons = allocationReasons(agent, tier, metrics);

  return {
    agentId: agent.id,
    action,
    tier,
    limits,
    summary: authorityUnavailable
      ? "Review the recommendation only. Agent or vault authority is currently paused."
      : allocationSummary(action, tier, limits),
    reasons,
    nextTier,
    nextTierGaps,
  };
}

function allocationMetrics(
  scorecard?: AgentScorecard | null,
  leaderboard?: AgentLeaderboardEntry | null,
) {
  const proposals = scorecard?.proposals ?? 0;
  const violations = scorecard?.ruleViolations ?? 0;
  return {
    executed: scorecard?.executed ?? 0,
    score: leaderboard?.score ?? 50,
    drawdownPct: scorecard?.maxDrawdownPct ?? 0,
    violationRatePct: proposals > 0 ? (violations / proposals) * 100 : 0,
    humanOverrides: scorecard?.humanOverrideCount ?? 0,
    pnlUsd: numberValue(scorecard?.realizedPnlUsd),
  };
}

function tierGaps(
  tier: AgentAllocationTier,
  metrics: ReturnType<typeof allocationMetrics>,
): string[] {
  const gaps: string[] = [];
  if (metrics.executed < tier.minimumExecuted) {
    gaps.push(`${tier.minimumExecuted - metrics.executed} more executed trades`);
  }
  if (metrics.score < tier.minimumScore) {
    gaps.push(`trust score ${tier.minimumScore} or higher`);
  }
  if (metrics.drawdownPct > tier.maximumDrawdownPct) {
    gaps.push(`drawdown at or below ${tier.maximumDrawdownPct}%`);
  }
  if (metrics.violationRatePct > tier.maximumViolationRatePct) {
    gaps.push(`violation rate at or below ${tier.maximumViolationRatePct}%`);
  }
  if (metrics.humanOverrides > tier.maximumHumanOverrides) {
    gaps.push(`${tier.maximumHumanOverrides} or fewer human overrides`);
  }
  if (tier.requiresPositivePnl && metrics.pnlUsd <= 0) {
    gaps.push("positive realized PnL");
  }
  return gaps;
}

function allocationAction(
  session: AgentSessionGrant | null | undefined,
  limits: AgentAllocationLimits,
  now: number,
): AgentAllocationAction {
  if (!session || session.status !== "active" || session.expiresAt <= now) {
    return "start";
  }
  const currentTier = agentAllocationTierById(session.allocationTierId);
  const recommendedTier = agentAllocationTierById(limits.tierId);
  if (currentTier && recommendedTier) {
    const currentIndex = AGENT_ALLOCATION_TIERS.indexOf(currentTier);
    const recommendedIndex = AGENT_ALLOCATION_TIERS.indexOf(recommendedTier);
    if (currentIndex > recommendedIndex) return "demote";
    if (currentIndex < recommendedIndex) return "promote";
  }
  const currentNotional = numberValue(session.maxNotionalUsd);
  const recommendedNotional = numberValue(limits.maxNotionalUsd);
  if (currentNotional > recommendedNotional) return "demote";
  if (currentNotional < recommendedNotional) return "promote";
  const matches =
    numberValue(session.maxLeverage) === limits.maxLeverage &&
    numberValue(session.maxOpenPositions) === limits.maxOpenPositions;
  return matches ? "hold" : "review";
}

function allocationReasons(
  agent: AgentProfile,
  tier: AgentAllocationTier,
  metrics: ReturnType<typeof allocationMetrics>,
): string[] {
  const reasons = [
    `${metrics.executed} executed trades`,
    `trust score ${formatNumber(metrics.score)}`,
    `${formatNumber(metrics.drawdownPct)}% maximum drawdown`,
    `${formatNumber(metrics.violationRatePct)}% violation rate`,
  ];
  if (metrics.humanOverrides > 0) {
    reasons.push(`${metrics.humanOverrides} human overrides`);
  }
  if (agent.status !== "active") {
    reasons.push(`agent is ${agent.status}; reactivate before starting authority`);
  }
  if (tier.id === "probation" && metrics.executed === 0) {
    reasons.unshift("new agents begin with the smallest bounded allocation");
  }
  return reasons;
}

function allocationSummary(
  action: AgentAllocationAction,
  tier: AgentAllocationTier,
  limits: AgentAllocationLimits,
): string {
  const authority = `${tier.label}: fund up to $${Number(limits.maxNotionalUsd).toLocaleString("en-US")} per trade, ${limits.maxLeverage}x leverage, ${limits.maxOpenPositions} open position${limits.maxOpenPositions === 1 ? "" : "s"}, for ${limits.sessionHours} hours`;
  if (action === "promote") return `Eligible to increase funding. ${authority}.`;
  if (action === "demote") return `Reduce the next funding window. ${authority}.`;
  if (action === "hold") return `Current funding window matches the recommendation. ${authority}.`;
  if (action === "review") return `Review current funding limits. ${authority}.`;
  return `Start with a human-approved bounded funding window. ${authority}.`;
}

function minPositive(first: number, second: number): number {
  const values = [first, second].filter(
    (value) => Number.isFinite(value) && value > 0,
  );
  return values.length > 0 ? Math.min(...values) : 1;
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function normalizeMarket(value: string): string {
  return value.trim().toUpperCase();
}
