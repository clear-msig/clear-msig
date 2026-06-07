import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  agentRiskSnapshot,
  approveAgentProposal,
  closeMockAgentExecution,
  closeOpenMockAgentExecutions,
  defaultAgentVaultPolicy,
  encryptAgentVaultPolicy,
  getAgentConnectionKit,
  getAgentVaultPolicy,
  listAgentEvents,
  listAgentExecutions,
  listAgentOwnerApprovals,
  listAgentSessions,
  listAgentScorecards,
  openAgentPaperTrade,
  publishAgentProfile,
  recheckAgentProposal,
  renewAgentSession,
  rotateAgentSignalKey,
  saveAgent,
  saveAgentOwnerApproval,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  saveAgentSession,
  saveAgentVaultPolicy,
  setAgentVaultEmergencyPause,
  updateAgentConnectionSettings,
  updateAgentStatus,
  unpublishAgentProfile,
  type AgentProfile,
  type AgentOwnerApproval,
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
    entryPrice: "67000",
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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent paper execution storage", () => {
  it("publishes and unpublishes an agent profile with audit history", () => {
    stubBrowserStorage();
    saveAgent(agent());

    const published = publishAgentProfile(
      "vault",
      "agent-alpha",
      "Public profile for user testing.",
    );
    expect(published?.publishing?.status).toBe("published");
    expect(published?.publishing?.slug).toBe("agent-alpha-agent-alpha");
    expect(published?.publishing?.publicSummary).toBe("Public profile for user testing.");

    const draft = unpublishAgentProfile("vault", "agent-alpha");
    expect(draft?.publishing?.status).toBe("draft");
    expect(draft?.publishing?.slug).toBe("agent-alpha-agent-alpha");
    expect(listAgentEvents("vault").map((event) => event.kind)).toEqual([
      "agent_profile_published",
      "agent_profile_unpublished",
    ]);
  });

  it("records owner approvals with an audit event", () => {
    stubBrowserStorage();
    const approval: AgentOwnerApproval = {
      id: "approval-1",
      walletName: "vault",
      agentId: "agent-alpha",
      action: "grant_allowance",
      summary: "Give practice allowance",
      details: [{ label: "Size", value: "$250" }],
      targetType: "session",
      targetId: "session-1",
      approvalMethod: "browser_confirm",
      approvedBy: null,
      signature: null,
      approvalHash: "hash-1",
      createdAt: now,
      version: 1,
    };

    saveAgentOwnerApproval(approval);
    saveAgentOwnerApproval(approval);

    expect(listAgentOwnerApprovals("vault")).toHaveLength(1);
    expect(listAgentEvents("vault").filter((event) => event.kind === "owner_action_approved")).toHaveLength(1);
  });

  it("counts a human approval of an approval-needed signal as an override", () => {
    stubBrowserStorage();
    saveAgent(agent());
    saveAgentVaultPolicy(defaultAgentVaultPolicy("vault", now));
    saveAgentProposal({
      ...proposal("proposal-needs-approval"),
      status: "needs_approval",
      evaluationDecision: "requires_human_approval",
    });

    approveAgentProposal("vault", "proposal-needs-approval");

    expect(listAgentScorecards("vault")[0]?.humanOverrideCount).toBe(1);
  });

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
    expect(first.execution?.executionMode).toBe("paper");
    expect(first.execution?.adapterStatus).toBe("ready");
    expect(first.execution?.entryPrice).toBe("67000");
    expect(listAgentSessions("vault")[0]?.policyHash).toBeTruthy();
    expect(first.proposal.policyHash).toBeTruthy();
    expect(first.execution?.policyHash).toBe(first.proposal.policyHash);
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

  it("closes all open paper trades for an agent in one action", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
      maxOpenPositionsPerAgent: 2,
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
      maxOpenPositions: 2,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    saveAgentProposalAndExecuteIfAllowed(proposal("proposal-1"));
    saveAgentProposalAndExecuteIfAllowed(proposal("proposal-2", "ETH-PERP"));

    const closed = closeOpenMockAgentExecutions({
      walletName: "vault",
      agentId: profile.id,
    });

    expect(closed).toHaveLength(2);
    expect(agentRiskSnapshot("vault", profile.id).openPositions).toBe(0);
    expect(listAgentExecutions("vault").filter((execution) => execution.status === "open")).toHaveLength(0);
    expect(listAgentEvents("vault").map((event) => event.kind)).toContain("execution_bulk_closed");
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

  it("keeps only one active session per agent", () => {
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
      expiresAt: now + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    saveAgentSession({
      id: "session-2",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now + 1_000,
      expiresAt: now + 2 * 60 * 60 * 1000,
      createdAt: now + 1_000,
      updatedAt: now + 1_000,
      version: 1,
    });

    const sessions = listAgentSessions("vault");

    expect(sessions.filter((session) => session.status === "active")).toHaveLength(1);
    expect(sessions.find((session) => session.id === "session-1")?.status).toBe(
      "revoked",
    );
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

  it("opens a human-approved paper trade when saved risk limits pass", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
    });
    saveAgentProposal(proposal("proposal-1"));

    const result = openAgentPaperTrade("vault", "proposal-1");

    expect(result.reason).toBe("opened");
    expect(result.execution?.status).toBe("open");
    expect(result.proposal?.status).toBe("executed");
    expect(listAgentExecutions("vault")).toHaveLength(1);
  });

  it("refreshes a proposal policy hash during the final paper execution check", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
    });
    const saved = saveAgentProposal(proposal("proposal-1"));
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
      maxSessionHours: 25,
    });
    const currentPolicy = getAgentVaultPolicy("vault");

    const result = openAgentPaperTrade("vault", "proposal-1");

    expect(saved.policyHash).not.toBe(currentPolicy.policyHash);
    expect(result.reason).toBe("opened");
    expect(result.proposal?.policyHash).toBe(currentPolicy.policyHash);
    expect(result.execution?.policyHash).toBe(currentPolicy.policyHash);
  });

  it("does not open an unapproved paper trade without a bounded session", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      cooldownSeconds: 0,
    });
    saveAgentProposal({
      ...proposal("proposal-1"),
      status: "needs_approval",
    });

    const result = openAgentPaperTrade("vault", "proposal-1");

    expect(result.reason).toBe("not_approved");
    expect(result.execution).toBeNull();
    expect(result.proposal?.status).toBe("needs_approval");
    expect(listAgentExecutions("vault")).toHaveLength(0);
  });

  it("blocks a human-approved paper trade when hard risk limits fail", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      maxNotionalUsd: "100",
      cooldownSeconds: 0,
    });
    saveAgentProposal(proposal("proposal-1"));

    const result = openAgentPaperTrade("vault", "proposal-1");

    expect(result.reason).toBe("blocked");
    expect(result.execution).toBeNull();
    expect(result.proposal?.status).toBe("blocked");
    expect(result.proposal?.policyViolations?.[0]?.code).toBe("notional_too_large");
    expect(listAgentExecutions("vault")).toHaveLength(0);
  });

  it("keeps encrypted pre-alpha risk controls enforceable at final execution", async () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);
    const encrypted = await encryptAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      maxNotionalUsd: "100",
      cooldownSeconds: 0,
    });
    saveAgentVaultPolicy(encrypted);
    saveAgentProposal(proposal("proposal-1"));

    const result = openAgentPaperTrade("vault", "proposal-1");

    expect(result.reason).toBe("blocked");
    expect(result.proposal?.policyViolations?.map((item) => item.code)).toContain(
      "notional_too_large",
    );
  });

  it("does not duplicate paper trades for the same bot retry id", () => {
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
      allowedMarkets: ["BTC-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 1,
      maxOpenPositions: 2,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const first = saveAgentProposalAndExecuteIfAllowed({
      ...proposal("proposal-1"),
      clientSignalId: "retry-duplicate-1",
    });
    const duplicate = saveAgentProposalAndExecuteIfAllowed({
      ...proposal("proposal-2"),
      clientSignalId: "retry-duplicate-1",
    });

    expect(first.execution?.status).toBe("open");
    expect(duplicate.proposal.id).toBe("proposal-1");
    expect(duplicate.execution).toBeNull();
    expect(listAgentExecutions("vault")).toHaveLength(1);
  });

  it("keeps testnet venue execution waiting for the backend adapter", () => {
    stubBrowserStorage();
    const profile: AgentProfile = {
      ...agent(),
      strategy: {
        ...agent().strategy!,
        mode: "bounded_live",
      },
    };
    saveAgent(profile);
    saveAgentVaultPolicy({
      ...defaultAgentVaultPolicy("vault", now),
      allowedVenues: ["hyperliquid_testnet"],
      cooldownSeconds: 0,
    });
    saveAgentSession({
      id: "session-1",
      walletName: "vault",
      agentId: profile.id,
      status: "active",
      startsAt: now,
      expiresAt: Date.now() + 60 * 60 * 1000,
      allowedVenues: ["hyperliquid_testnet"],
      allowedMarkets: ["BTC-PERP"],
      maxNotionalUsd: "300",
      maxLeverage: 1,
      maxOpenPositions: 1,
      createdAt: now,
      updatedAt: now,
      version: 1,
    });

    const result = saveAgentProposalAndExecuteIfAllowed({
      ...proposal("proposal-hl"),
      venue: "hyperliquid_testnet",
    });

    expect(result.proposal.status).toBe("approved");
    expect(result.execution).toBeNull();
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

  it("creates and rotates a non-custodial signal key", () => {
    stubBrowserStorage();
    const profile = agent();
    saveAgent(profile);

    const first = getAgentConnectionKit("vault", profile.id);
    const again = getAgentConnectionKit("vault", profile.id);
    const enabled = updateAgentConnectionSettings("vault", profile.id, {
      autoImportSessionSignals: true,
    });
    const rotated = rotateAgentSignalKey("vault", profile.id);

    expect(first.signalKey).toMatch(/^cs_sig_/);
    expect(first.managementKey).toMatch(/^cs_mgmt_/);
    expect(first.autoImportSessionSignals).toBe(false);
    expect(again.signalKey).toBe(first.signalKey);
    expect(again.managementKey).toBe(first.managementKey);
    expect(enabled?.autoImportSessionSignals).toBe(true);
    expect(rotated?.signalKey).not.toBe(first.signalKey);
    expect(rotated?.managementKey).toBe(first.managementKey);
    expect(rotated?.autoImportSessionSignals).toBe(true);
  });

  it("toggles the vault kill switch and records an audit event", () => {
    stubBrowserStorage();
    saveAgent(agent());

    const paused = setAgentVaultEmergencyPause("vault", true);
    const resumed = setAgentVaultEmergencyPause("vault", false);
    const events = listAgentEvents("vault");

    expect(paused.emergencyPaused).toBe(true);
    expect(resumed.emergencyPaused).toBe(false);
    expect(paused.policyHash).toBe(resumed.policyHash);
    expect(events.map((event) => event.kind)).toEqual(
      expect.arrayContaining(["policy_emergency_pause_changed"]),
    );
  });
});
