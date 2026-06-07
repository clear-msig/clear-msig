import { describe, expect, it } from "vitest";
import {
  buildAgentScoutProposal,
  buildAgentScoutReports,
  defaultAgentVaultPolicy,
  bindAgentSessionPolicyHash,
  type AgentProfile,
  type AgentSessionGrant,
  type AgentVaultPolicy,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

function agent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: "vault",
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "paper",
      summary: "Scouts BTC and ETH momentum.",
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      entryRules: "Enter only when market data and the allowance agree.",
      exitRules: "Exit on stop, target, or failed thesis.",
      riskRules: "Keep size small and obey ClearSig.",
      executionProtocol: "Prepare one idea at a time.",
      killSwitchRules: "Stop when ClearSig pauses trading.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function session(
  policy: AgentVaultPolicy,
  overrides: Partial<AgentSessionGrant> = {},
): AgentSessionGrant {
  return bindAgentSessionPolicyHash({
    id: "session-1",
    walletName: "vault",
    agentId: "agent-alpha",
    status: "active",
    startsAt: now - 1_000,
    expiresAt: now + 60_000,
    allowedVenues: ["mock_perps"],
    allowedMarkets: ["BTC-PERP", "ETH-PERP"],
    maxNotionalUsd: "150",
    maxLeverage: 1,
    maxOpenPositions: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  }, policy);
}

describe("agent scout", () => {
  it("builds a ready scout report and checked proposal from market data", () => {
    const profile = agent();
    const policy = defaultAgentVaultPolicy("vault", now);
    const activeSession = session(policy);
    const reports = buildAgentScoutReports({
      agents: [profile],
      policy,
      sessions: [activeSession],
      risksByAgent: {
        [profile.id]: { openPositions: 0, dailyRealizedPnlUsd: "0" },
      },
      marketByMarket: {
        "BTC-PERP": {
          provider: "hyperliquid",
          source: "live",
          market: "BTC-PERP",
          observedAt: now,
          markPriceUsd: "70000",
          fundingRatePct: "0.01",
          openInterestUsd: "2000000",
          volume24hUsd: "5000000",
        },
      },
      now,
    });

    expect(reports[0]?.status).toBe("ready");
    expect(reports[0]?.market).toBe("BTC-PERP");
    expect(reports[0]?.score).toBeGreaterThan(70);

    const built = buildAgentScoutProposal({
      report: reports[0]!,
      agent: profile,
      policy,
      session: activeSession,
      risk: { openPositions: 0, dailyRealizedPnlUsd: "0" },
      id: "proposal-1",
      now,
    });

    expect(built.evaluation.decision).toBe("allowed");
    expect(built.proposal.status).toBe("approved");
    expect(built.proposal.decisionJournal?.summary).toContain("scouted BTC-PERP");
    expect(built.proposal.decisionJournal?.evidence.some((item) => item.kind === "market_data")).toBe(true);
  });

  it("shows blocked when the active safety policy cannot allow the idea", () => {
    const profile = agent();
    const policy = {
      ...defaultAgentVaultPolicy("vault", now),
      emergencyPaused: true,
    };
    const reports = buildAgentScoutReports({
      agents: [profile],
      policy,
      sessions: [session(policy)],
      risksByAgent: {
        [profile.id]: { openPositions: 0, dailyRealizedPnlUsd: "0" },
      },
      marketByMarket: {},
      now,
    });

    expect(reports[0]?.status).toBe("blocked");
    expect(reports[0]?.policySummary).toContain("paused");
    expect(reports[0]?.nextAction).toContain("Fix");
  });
});
