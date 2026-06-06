import { describe, expect, it } from "vitest";
import {
  buildAgentTradingReadiness,
  defaultAgentVaultPolicy,
  type AgentProfile,
  type AgentSessionGrant,
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
      entryRules: "Trade only clean momentum setups.",
      exitRules: "Exit at invalidation or target.",
      riskRules: "Respect vault risk limits.",
      executionProtocol: "Open paper trades only inside active sessions.",
      killSwitchRules: "Stop trading when risk fails.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function session(overrides: Partial<AgentSessionGrant> = {}): AgentSessionGrant {
  return {
    id: "session-1",
    walletName: "vault",
    agentId: "agent-alpha",
    status: "active",
    startsAt: now,
    expiresAt: now + 60 * 60 * 1000,
    allowedVenues: ["mock_perps"],
    allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "300",
    maxLeverage: 2,
    maxOpenPositions: 1,
    policyHash: defaultAgentVaultPolicy("vault", now).policyHash,
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

describe("agent trading readiness", () => {
  it("marks a fully configured paper agent as ready", () => {
    const readiness = buildAgentTradingReadiness({
      agent: agent(),
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session()],
      risk: { openPositions: 0, dailyRealizedPnlUsd: "0" },
      now,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.score).toBe(100);
    expect(readiness.primaryAction).toBe("none");
  });

  it("points users to strategy setup when the playbook is missing", () => {
    const readiness = buildAgentTradingReadiness({
      agent: agent({ strategy: undefined }),
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session()],
      risk: { openPositions: 0, dailyRealizedPnlUsd: "0" },
      now,
    });

    expect(readiness.status).toBe("needs_setup");
    expect(readiness.primaryAction).toBe("strategy");
    expect(readiness.items.find((item) => item.id === "strategy")?.status).toBe(
      "todo",
    );
  });

  it("blocks readiness when the daily loss cap has been reached", () => {
    const readiness = buildAgentTradingReadiness({
      agent: agent(),
      policy: { ...defaultAgentVaultPolicy("vault", now), dailyLossCapUsd: "50" },
      sessions: [session()],
      risk: { openPositions: 0, dailyRealizedPnlUsd: "-55" },
      now,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.primaryAction).toBe("agent");
    expect(readiness.items.find((item) => item.id === "daily-loss")?.status).toBe(
      "block",
    );
  });

  it("points users to session renewal when the policy commitment is stale", () => {
    const readiness = buildAgentTradingReadiness({
      agent: agent(),
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session({ policyHash: "older-policy-hash" })],
      risk: { openPositions: 0, dailyRealizedPnlUsd: "0" },
      now,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.primaryAction).toBe("session");
    expect(readiness.items.find((item) => item.id === "session")?.message).toContain(
      "safety rules changed",
    );
  });
});
