import { describe, expect, it } from "vitest";
import { buildAgentBetaReadiness } from "@/lib/agents/betaReadiness";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { bindAgentSessionPolicyHash } from "@/lib/agents/policyHash";
import type {
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentSessionGrant,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent beta readiness", () => {
  it("marks a complete paper/testing setup ready", () => {
    const policy = defaultAgentVaultPolicy("vault", now);
    const readiness = buildAgentBetaReadiness({
      agents: [agent()],
      policy,
      sessions: [bindAgentSessionPolicyHash(session(), policy)],
      executions: [execution()],
      proposals: [],
      approvals: [approval()],
      connections: [connection(true)],
      backend: { state: "synced", storage: "redis" },
      marketData: { openMarkets: 1, pricedOpenMarkets: 1 },
      venue: { state: "connected" },
      walletHref: "/app/wallet/vault",
      now,
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.score).toBe(100);
  });

  it("blocks public beta when persistence is unavailable", () => {
    const readiness = buildAgentBetaReadiness({
      agents: [agent()],
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session()],
      executions: [],
      proposals: [],
      approvals: [],
      connections: [],
      backend: { state: "local" },
      marketData: { openMarkets: 0, pricedOpenMarkets: 0 },
      venue: { state: "needs_setup" },
      walletHref: "/app/wallet/vault",
      now,
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.find((check) => check.id === "persistence")?.status).toBe(
      "block",
    );
  });
});

function agent(): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: "vault",
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "paper",
      allowedMarkets: ["BTC-PERP"],
      entryRules: "Momentum setup.",
      exitRules: "Exit on invalidation.",
      riskRules: "Respect vault limits.",
      executionProtocol: "Paper only.",
      killSwitchRules: "Stop on safety failure.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function session(): AgentSessionGrant {
  return {
    id: "session-1",
    walletName: "vault",
    agentId: "agent-alpha",
    status: "active",
    startsAt: now,
    expiresAt: now + 60 * 60 * 1000,
    allowedVenues: ["mock_perps"],
    allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "250",
    maxLeverage: 1,
    maxOpenPositions: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function execution(): AgentExecutionRecord {
  return {
    id: "execution-1",
    walletName: "vault",
    proposalId: "proposal-1",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    entryPrice: "100",
    status: "open",
    openedAt: now,
    realizedPnlUsd: "0",
    version: 1,
  };
}

function approval(): AgentOwnerApproval {
  return {
    id: "approval-1",
    walletName: "vault",
    agentId: "agent-alpha",
    action: "start_automatic_trading",
    summary: "Turn on automatic trading",
    details: [],
    targetType: "agent",
    targetId: "agent-alpha",
    approvalMethod: "browser_confirm",
    approvedBy: null,
    signature: null,
    approvalHash: "approval-hash",
    createdAt: now,
    version: 1,
  };
}

function connection(enabled: boolean): AgentConnectionKit {
  return {
    walletName: "vault",
    agentId: "agent-alpha",
    signalKey: "cs_sig_1",
    managementKey: "cs_mgmt_1",
    autoImportSessionSignals: enabled,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
