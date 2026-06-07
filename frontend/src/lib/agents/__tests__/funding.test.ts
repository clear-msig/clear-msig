import { describe, expect, it } from "vitest";
import {
  buildAgentFundingPlan,
  defaultAgentVaultPolicy,
  type AgentLeaderboardEntry,
  type AgentProfile,
  type AgentScorecard,
  type AgentSessionGrant,
} from "@/lib/agents";

const now = 1_800_000_000_000;

function agent(id: string, name = id): AgentProfile {
  return {
    id,
    walletName: "vault",
    name,
    kind: "api",
    status: "active",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function scorecard(
  agentId: string,
  overrides: Partial<AgentScorecard> = {},
): AgentScorecard {
  return {
    walletName: "vault",
    agentId,
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

function leader(agentId: string, score: number): AgentLeaderboardEntry {
  return {
    walletName: "vault",
    agentId,
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

describe("agent funding plan", () => {
  it("prioritizes traders that earned a larger allowance", () => {
    const agents = [agent("starter"), agent("winner")];
    const policy = { ...defaultAgentVaultPolicy("vault"), policyHash: "policy-1" };
    const plan = buildAgentFundingPlan({
      agents,
      scorecards: [
        scorecard("starter"),
        scorecard("winner", {
          proposals: 25,
          executed: 22,
          realizedPnlUsd: "150",
          ruleViolations: 1,
          maxDrawdownPct: 4,
        }),
      ],
      leaderboard: [leader("starter", 50), leader("winner", 78)],
      sessions: [
        {
          id: "session-winner",
          walletName: "vault",
          agentId: "winner",
          status: "active",
          startsAt: now - 1_000,
          expiresAt: now + 60_000,
          maxNotionalUsd: "250",
          maxLeverage: 1,
          maxOpenPositions: 1,
          allocationTierId: "probation",
          policyHash: "policy-1",
          createdAt: now,
          updatedAt: now,
          version: 1,
        },
      ] satisfies AgentSessionGrant[],
      policy,
      now,
    });

    expect(plan.recommendations[0]?.agent.id).toBe("winner");
    expect(plan.recommendations[0]?.action).toBe("raise");
    expect(plan.raiseCount).toBe(1);
    expect(plan.activeAllowances).toBe(1);
  });

  it("does not include revoked traders", () => {
    const active = agent("active");
    const revoked = { ...agent("revoked"), status: "revoked" as const };
    const plan = buildAgentFundingPlan({
      agents: [revoked, active],
      scorecards: [],
      leaderboard: [],
      sessions: [],
      policy: defaultAgentVaultPolicy("vault"),
      now,
    });

    expect(plan.recommendations.map((item) => item.agent.id)).toEqual(["active"]);
  });
});
