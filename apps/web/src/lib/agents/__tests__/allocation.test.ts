import { describe, expect, it } from "vitest";
import {
  boundAgentSessionToPolicy,
  defaultAgentVaultPolicy,
  recommendAgentAllocation,
  type AgentLeaderboardEntry,
  type AgentProfile,
  type AgentScorecard,
  type AgentSessionGrant,
} from "@/lib/agents";

const now = Date.now();
const agent: AgentProfile = {
  id: "agent-alpha",
  walletName: "vault",
  name: "Agent Alpha",
  kind: "api",
  status: "active",
  createdAt: now,
  updatedAt: now,
  version: 1,
};

function scorecard(overrides: Partial<AgentScorecard> = {}): AgentScorecard {
  return {
    walletName: "vault",
    agentId: "agent-alpha",
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
    ...overrides,
  };
}

function leaderboard(score: number): AgentLeaderboardEntry {
  return {
    walletName: "vault",
    agentId: "agent-alpha",
    score,
    rankInputs: {
      returnScore: score,
      complianceScore: score,
      drawdownScore: score,
      executionScore: score,
      trustPenalty: 0,
    },
  };
}

describe("agent capital allocation recommendations", () => {
  it("keeps a new allowance inside wallet safety rules", () => {
    const policy = {
      ...defaultAgentVaultPolicy("vault", now),
      allowedVenues: ["mock_perps"] as const,
      allowedMarkets: ["BTC-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 2,
      maxOpenPositionsPerAgent: 1,
      maxSessionHours: 4,
    };
    const bounded = boundAgentSessionToPolicy(
      {
        id: "session-bounded",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 12 * 60 * 60 * 1000,
        allowedVenues: ["mock_perps", "hyperliquid_testnet"],
        allowedMarkets: ["BTC-PERP", "DOGE-PERP"],
        maxNotionalUsd: "1000",
        maxLeverage: 5,
        maxOpenPositions: 5,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      { ...policy, allowedVenues: [...policy.allowedVenues] },
    );

    expect(bounded.allowedVenues).toEqual(["mock_perps"]);
    expect(bounded.allowedMarkets).toEqual(["BTC-PERP"]);
    expect(bounded.maxNotionalUsd).toBe("300");
    expect(bounded.maxLeverage).toBe(2);
    expect(bounded.maxOpenPositions).toBe(1);
    expect(bounded.expiresAt).toBe(now + 4 * 60 * 60 * 1000);
  });

  it("starts new agents at a policy-clamped probation tier", () => {
    const policy = {
      ...defaultAgentVaultPolicy("vault"),
      maxNotionalUsd: "200",
    };
    const recommendation = recommendAgentAllocation({
      agent,
      scorecard: scorecard(),
      leaderboard: leaderboard(50),
      policy,
    });

    expect(recommendation.tier.id).toBe("probation");
    expect(recommendation.action).toBe("start");
    expect(recommendation.limits.maxNotionalUsd).toBe("200");
    expect(recommendation.nextTierGaps).toContain("20 more executed trades");
  });

  it("promotes a compliant profitable agent to trusted", () => {
    const session: AgentSessionGrant = {
      id: "session-1",
      walletName: "vault",
      agentId: "agent-alpha",
      status: "active",
      startsAt: now,
      expiresAt: now + 60_000,
      maxNotionalUsd: "250",
      maxLeverage: 1,
      maxOpenPositions: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const recommendation = recommendAgentAllocation({
      agent,
      scorecard: scorecard({
        proposals: 25,
        executed: 22,
        realizedPnlUsd: "120",
        maxDrawdownPct: 5,
        ruleViolations: 1,
      }),
      leaderboard: leaderboard(76),
      currentSession: session,
      policy: defaultAgentVaultPolicy("vault"),
    });

    expect(recommendation.tier.id).toBe("trusted");
    expect(recommendation.action).toBe("promote");
  });

  it("recommends proven only after enough clean history", () => {
    const recommendation = recommendAgentAllocation({
      agent,
      scorecard: scorecard({
        proposals: 60,
        executed: 55,
        realizedPnlUsd: "500",
        maxDrawdownPct: 4,
        ruleViolations: 2,
      }),
      leaderboard: leaderboard(88),
      policy: {
        ...defaultAgentVaultPolicy("vault"),
        maxNotionalUsd: "2000",
        maxOpenPositionsPerAgent: 5,
      },
    });

    expect(recommendation.tier.id).toBe("proven");
    expect(recommendation.limits.maxNotionalUsd).toBe("1000");
    expect(recommendation.nextTier).toBeNull();
  });

  it("demotes an oversized active session when performance no longer qualifies", () => {
    const recommendation = recommendAgentAllocation({
      agent,
      scorecard: scorecard({
        proposals: 10,
        executed: 8,
        realizedPnlUsd: "-20",
        maxDrawdownPct: 20,
        ruleViolations: 4,
      }),
      leaderboard: leaderboard(40),
      currentSession: {
        id: "session-oversized",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60_000,
        maxNotionalUsd: "500",
        maxLeverage: 2,
        maxOpenPositions: 2,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      policy: defaultAgentVaultPolicy("vault"),
    });

    expect(recommendation.tier.id).toBe("probation");
    expect(recommendation.action).toBe("demote");
  });
});
