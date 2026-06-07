import { describe, expect, it } from "vitest";
import {
  defaultAgentVaultPolicy,
  evaluateAgentTradeProposal,
  rankAgents,
  type AgentProfile,
  type AgentScorecard,
  type AgentTradeProposal,
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
      allowedMarkets: ["BTC-PERP", "ETH-PERP", "SOL-PERP"],
      entryRules: "Momentum setup only.",
      exitRules: "Use defined invalidation.",
      riskRules: "Respect all vault limits.",
      executionProtocol: "Paper execution inside active sessions.",
      killSwitchRules: "Stop when risk fails.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function proposal(overrides: Partial<AgentTradeProposal> = {}): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName: "vault",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 2,
    stopLossPrice: "65000",
    takeProfitPrice: null,
    thesis: "Momentum breakout.",
    confidence: 72,
    expiresAt: now + 60_000,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

describe("agent policy evaluator", () => {
  it("allows a valid proposal to proceed to human approval", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: defaultAgentVaultPolicy("vault", now),
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("requires_human_approval");
    expect(result.violations).toHaveLength(0);
    expect(result.normalized.market).toBe("BTC-PERP");
  });

  it("allows bounded execution when an active session is inside limits", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: defaultAgentVaultPolicy("vault", now),
      session: {
        id: "session-1",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60 * 60 * 1000,
        maxNotionalUsd: "300",
        maxLeverage: 2,
        allowedMarkets: ["BTC-PERP"],
        allowedVenues: ["mock_perps"],
        policyHash: defaultAgentVaultPolicy("vault", now).policyHash,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("allowed");
    expect(result.violations).toHaveLength(0);
  });

  it("blocks proposals outside vault limits", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal({
        venue: "hyperliquid_testnet",
        market: "DOGE-PERP",
        notionalUsd: "2500",
        leverage: 5,
        stopLossPrice: null,
      }),
      policy: defaultAgentVaultPolicy("vault", now),
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toEqual(
      expect.arrayContaining([
        "venue_not_allowed",
        "market_not_allowed",
        "notional_too_large",
        "leverage_too_high",
        "stop_loss_required",
      ]),
    );
  });

  it("blocks every signal when the kill switch is on", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: {
        ...defaultAgentVaultPolicy("vault", now),
        emergencyPaused: true,
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain("emergency_paused");
  });

  it("blocks trading while wallet safety rules are incomplete", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: {
        ...defaultAgentVaultPolicy("vault", now),
        maxNotionalUsd: "",
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain("policy_incomplete");
  });

  it("applies session limits as a tighter bound", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal({ notionalUsd: "250" }),
      policy: defaultAgentVaultPolicy("vault", now),
      session: {
        id: "session-1",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60 * 60 * 1000,
        maxNotionalUsd: "100",
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain("notional_too_large");
  });

  it("blocks a practice account excluded by the current allowance", () => {
    const policy = {
      ...defaultAgentVaultPolicy("vault", now),
      allowedVenues: ["mock_perps", "hyperliquid_testnet"] as const,
    };
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal({ venue: "hyperliquid_testnet" }),
      policy: { ...policy, allowedVenues: [...policy.allowedVenues] },
      session: {
        id: "session-venue-bound",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60 * 60 * 1000,
        allowedVenues: ["mock_perps"],
        policyHash: policy.policyHash,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain("venue_not_allowed");
  });

  it("blocks trading when safety rules allow no markets", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: {
        ...defaultAgentVaultPolicy("vault", now),
        allowedMarkets: [],
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain("market_not_allowed");
  });

  it("requires human approval when a bounded session has a stale policy hash", () => {
    const policy = defaultAgentVaultPolicy("vault", now);
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy,
      session: {
        id: "session-stale",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60 * 60 * 1000,
        policyHash: "older-policy-hash",
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("requires_human_approval");
    expect(result.violations.map((v) => v.code)).toContain("session_policy_stale");
  });

  it("blocks active cooldowns", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: defaultAgentVaultPolicy("vault", now),
      risk: { openPositions: 0, lastTradeAt: now - 30_000 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain("cooldown_active");
  });

  it("requires human approval when an active session has no strategy playbook", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent({ strategy: undefined }),
      proposal: proposal(),
      policy: defaultAgentVaultPolicy("vault", now),
      session: {
        id: "session-1",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60 * 60 * 1000,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("requires_human_approval");
    expect(result.violations.map((v) => v.code)).toContain("strategy_missing");
  });

  it("blocks signals outside the agent strategy playbook", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal({ market: "DOGE-PERP" }),
      policy: defaultAgentVaultPolicy("vault", now),
      risk: { openPositions: 0 },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain(
      "strategy_market_not_allowed",
    );
  });

  it("blocks bounded execution after the daily loss cap is reached", () => {
    const result = evaluateAgentTradeProposal({
      agent: agent(),
      proposal: proposal(),
      policy: { ...defaultAgentVaultPolicy("vault", now), dailyLossCapUsd: "50" },
      session: {
        id: "session-1",
        walletName: "vault",
        agentId: "agent-alpha",
        status: "active",
        startsAt: now,
        expiresAt: now + 60 * 60 * 1000,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      risk: { openPositions: 0, dailyRealizedPnlUsd: "-55" },
      now,
    });

    expect(result.decision).toBe("blocked");
    expect(result.violations.map((v) => v.code)).toContain(
      "daily_loss_cap_reached",
    );
  });
});

describe("agent leaderboard scoring", () => {
  it("ranks higher-return compliant agents first", () => {
    const base: Omit<AgentScorecard, "agentId" | "realizedPnlUsd" | "ruleViolations"> = {
      walletName: "vault",
      proposals: 10,
      approved: 8,
      rejected: 1,
      blocked: 1,
      executed: 8,
      maxDrawdownPct: 4,
      humanOverrideCount: 0,
      updatedAt: now,
      version: 1,
    };

    const ranked = rankAgents([
      { ...base, agentId: "agent-b", realizedPnlUsd: "50", ruleViolations: 3 },
      { ...base, agentId: "agent-a", realizedPnlUsd: "500", ruleViolations: 0 },
    ]);

    expect(ranked[0]?.agentId).toBe("agent-a");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});
