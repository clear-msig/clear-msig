import { describe, expect, it } from "vitest";
import { buildAgentMarketReadiness } from "@/lib/agents/marketReadiness";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import type {
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent market readiness", () => {
  it("keeps controlled paper usable while public launch blockers remain explicit", () => {
    const readiness = buildAgentMarketReadiness({
      agents: [agent()],
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session()],
      executions: [paperExecution()],
      proposals: [proposal()],
      approvals: [signedApproval()],
      connections: [connection()],
      backend: { state: "synced", storage: "redis" },
      marketData: {
        openMarkets: 1,
        pricedOpenMarkets: 1,
        liveMarkets: 1,
        hasFundingRates: true,
      },
      venue: { state: "connected" },
      walletHref: "/app/wallet/vault",
      operations: {
        walletSignedMutations: "partial",
        creatorRegistry: "local_profiles",
        creatorPayouts: "not_started",
        externalVerification: "signal_key",
        leaderboardMode: "paper_only",
        compliance: "draft",
        moderation: "none",
        abuseControls: {
          sameOrigin: true,
          rateLimits: true,
          signalKeys: true,
          replayProtection: true,
          signedSignals: false,
        },
      },
    });

    expect(
      readiness.phases.find((phase) => phase.id === "controlled_paper")?.status,
    ).toBe("needs_work");
    expect(readiness.status).toBe("blocked");
    expect(readiness.checks.find((check) => check.id === "creator-payouts")?.status).toBe(
      "block",
    );
    expect(readiness.checks.find((check) => check.id === "admin-moderation")?.status).toBe(
      "block",
    );
  });

  it("blocks live launch when venue trades lack verified exchange artifacts", () => {
    const readiness = buildAgentMarketReadiness({
      agents: [agent()],
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session()],
      executions: [testnetExecution({ externalOrderId: null })],
      proposals: [proposal()],
      approvals: [signedApproval()],
      connections: [connection()],
      backend: { state: "synced", storage: "redis" },
      marketData: {
        openMarkets: 1,
        pricedOpenMarkets: 1,
        liveMarkets: 1,
        hasFundingRates: true,
      },
      venue: { state: "connected" },
      walletHref: "/app/wallet/vault",
      operations: {
        walletSignedMutations: "required",
        creatorRegistry: "verified_registry",
        creatorPayouts: "sandbox",
        externalVerification: "verified_signing",
        marketIntelligence: { news: true, macro: true, rateLimited: true },
        leaderboardMode: "separated",
        compliance: "reviewed",
        moderation: "active",
        abuseControls: {
          sameOrigin: true,
          rateLimits: true,
          signalKeys: true,
          replayProtection: true,
          signedSignals: true,
        },
        venueReconciliation: "verified_fills",
      },
    });

    expect(
      readiness.checks.find((check) => check.id === "venue-reconciliation")?.status,
    ).toBe("block");
    expect(readiness.phases.find((phase) => phase.id === "live_capital")?.status).toBe(
      "blocked",
    );
  });

  it("marks the full launch path ready when every market gate is satisfied", () => {
    const readiness = buildAgentMarketReadiness({
      agents: [agent()],
      policy: defaultAgentVaultPolicy("vault", now),
      sessions: [session()],
      executions: [testnetExecution({ externalOrderId: "hl-test-order-1" })],
      proposals: [proposal()],
      approvals: [signedApproval()],
      connections: [connection()],
      backend: { state: "synced", storage: "redis" },
      marketData: {
        openMarkets: 1,
        pricedOpenMarkets: 1,
        liveMarkets: 1,
        hasFundingRates: true,
      },
      venue: { state: "connected" },
      walletHref: "/app/wallet/vault",
      operations: {
        walletSignedMutations: "required",
        creatorRegistry: "verified_registry",
        creatorPayouts: "live",
        externalVerification: "verified_signing",
        marketIntelligence: { news: true, macro: true, rateLimited: true },
        leaderboardMode: "separated",
        compliance: "reviewed",
        moderation: "active",
        abuseControls: {
          sameOrigin: true,
          rateLimits: true,
          signalKeys: true,
          replayProtection: true,
          signedSignals: true,
        },
        venueReconciliation: "verified_fills",
      },
    });

    expect(readiness.status).toBe("ready");
    expect(readiness.score).toBe(100);
    expect(readiness.phases.every((phase) => phase.status === "ready")).toBe(true);
  });
});

function agent(): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: "vault",
    name: "Agent Alpha",
    kind: "api",
    status: "active",
    identityPubkey: "creator-pubkey",
    endpoint: "https://agent.example/signal",
    publishing: {
      status: "published",
      slug: "agent-alpha",
      publicSummary: "A creator-owned practice trader.",
      visibleMetrics: ["score", "realized_pnl", "closed_trades"],
      publishedAt: now,
      updatedAt: now,
      version: 1,
    },
    strategy: {
      mode: "paper",
      allowedMarkets: ["BTC-PERP"],
      entryRules: "Momentum setup.",
      exitRules: "Exit on invalidation.",
      riskRules: "Respect ClearSig limits.",
      executionProtocol: "Submit signed decisions to ClearSig.",
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

function paperExecution(): AgentExecutionRecord {
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
    executionMode: "paper",
    status: "open",
    openedAt: now,
    realizedPnlUsd: "0",
    version: 1,
  };
}

function testnetExecution({
  externalOrderId,
}: {
  externalOrderId: string | null;
}): AgentExecutionRecord {
  return {
    ...paperExecution(),
    id: "execution-testnet-1",
    venue: "hyperliquid_testnet",
    executionMode: "testnet",
    externalOrderId,
  };
}

function proposal(): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName: "vault",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "95",
    takeProfitPrice: "110",
    confidence: 70,
    clientSignalId: "creator-signal-1",
    expiresAt: now + 15 * 60 * 1000,
    status: "approved",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function signedApproval(): AgentOwnerApproval {
  return {
    id: "approval-1",
    walletName: "vault",
    agentId: "agent-alpha",
    action: "grant_allowance",
    summary: "Grant allowance",
    details: [],
    targetType: "session",
    targetId: "session-1",
    approvalMethod: "wallet_signature",
    approvedBy: "owner-pubkey",
    signature: "aa".repeat(64),
    approvalHash: "approval-hash",
    createdAt: now,
    version: 1,
  };
}

function connection(): AgentConnectionKit {
  return {
    walletName: "vault",
    agentId: "agent-alpha",
    signalKey: "cs_sig_1",
    managementKey: "cs_mgmt_1",
    autoImportSessionSignals: true,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
