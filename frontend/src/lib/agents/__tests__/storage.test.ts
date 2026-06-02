import { afterEach, describe, expect, it, vi } from "vitest";
import {
  agentRiskSnapshot,
  closeMockAgentExecution,
  defaultAgentVaultPolicy,
  listAgentExecutions,
  listAgentSessions,
  listAgentScorecards,
  recheckAgentProposal,
  renewAgentSession,
  saveAgent,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  saveAgentSession,
  saveAgentVaultPolicy,
  updateAgentStatus,
  type AgentProfile,
  type AgentTradeProposal,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    clear: () => store.clear(),
  };
}

function stubBrowserStorage() {
  const localStorage = makeLocalStorageStub();
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as never);
  return localStorage;
}

function agent(): AgentProfile {
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
  };
}

function proposal(id: string, market = "BTC-PERP"): AgentTradeProposal {
  return {
    id,
    walletName: "vault",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market,
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "65000",
    takeProfitPrice: null,
    thesis: "Momentum breakout.",
    confidence: 72,
    expiresAt: Date.now() + 60_000,
    status: "approved",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent paper execution storage", () => {
  it("opens session-approved paper trades, applies open-position risk, and records PnL", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy(defaultAgentVaultPolicy("vault", now));
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      allowedVenues: ["mock_perps"],
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 1,
      maxOpenPositions: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const first = saveAgentProposalAndExecuteIfAllowed(proposal("proposal-1"));
    expect(first.execution?.status).toBe("open");
    expect(agentRiskSnapshot("vault", profile.id).openPositions).toBe(1);

    const second = saveAgentProposalAndExecuteIfAllowed(
      proposal("proposal-2", "ETH-PERP"),
    );
    expect(second.execution).toBeNull();
    expect(listAgentExecutions("vault")).toHaveLength(1);

    const closed = closeMockAgentExecution("vault", first.execution?.id ?? "", "42.5");
    expect(closed?.status).toBe("closed");
    expect(agentRiskSnapshot("vault", profile.id).openPositions).toBe(0);
    expect(listAgentScorecards("vault")[0]?.realizedPnlUsd).toBe("42.5");
  });

  it("revokes active sessions when a trading agent is revoked", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const updated = updateAgentStatus("vault", profile.id, "revoked");

    expect(updated?.status).toBe("revoked");
    expect(listAgentSessions("vault")[0]?.status).toBe("revoked");
  });

  it("reactivates revoked agents and renews a fresh trading session", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      maxNotionalUsd: "250",
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    updateAgentStatus("vault", profile.id, "revoked");
    updateAgentStatus("vault", profile.id, "active");

    const renewed = renewAgentSession("vault", "session-1");

    expect(renewed?.status).toBe("active");
    expect(renewed?.id).not.toBe("session-1");
    expect(listAgentSessions("vault").filter((session) => session.status === "active")).toHaveLength(1);
  });

  it("rechecks a blocked signal after risk changes and opens a paper trade", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
    });
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      allowedVenues: ["mock_perps"],
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 1,
      maxOpenPositions: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    const first = saveAgentProposalAndExecuteIfAllowed(proposal("proposal-1"));
    saveAgentProposal({
      ...proposal("proposal-2", "ETH-PERP"),
      status: "blocked",
      evaluationDecision: "blocked",
      policyViolations: [
        {
          code: "too_many_open_positions",
          message: "Agent already has one open position.",
          severity: "block",
        },
      ],
    });
    closeMockAgentExecution("vault", first.execution?.id ?? "", "10");

    const result = recheckAgentProposal("vault", "proposal-2");

    expect(result?.proposal.status).toBe("executed");
    expect(result?.execution?.status).toBe("open");
    expect(listAgentExecutions("vault")).toHaveLength(2);
  });

  it("does not auto-execute session signals without a strategy playbook", () => {
    stubBrowserStorage();
    const profile = { ...agent(), strategy: undefined };
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
    });
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      allowedVenues: ["mock_perps"],
      allowedMarkets: ["BTC-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 1,
      maxOpenPositions: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const result = saveAgentProposalAndExecuteIfAllowed(proposal("proposal-1"));

    expect(result.execution).toBeNull();
    expect(result.proposal.status).toBe("approved");
    expect(listAgentExecutions("vault")).toHaveLength(0);
  });

  it("blocks auto-execution after today's loss cap is reached", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
      dailyLossCapUsd: "20",
    });
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      allowedVenues: ["mock_perps"],
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 1,
      maxOpenPositions: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    const first = saveAgentProposalAndExecuteIfAllowed(proposal("proposal-1"));
    closeMockAgentExecution("vault", first.execution?.id ?? "", "-25");

    const second = saveAgentProposalAndExecuteIfAllowed(
      proposal("proposal-2", "ETH-PERP"),
    );

    expect(second.execution).toBeNull();
    expect(second.proposal.status).toBe("approved");
    expect(agentRiskSnapshot("vault", profile.id).dailyRealizedPnlUsd).toBe("-25");
  });
});
