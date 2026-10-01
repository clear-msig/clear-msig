import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAgentDashboardActions } from "./useAgentDashboardActions";
import * as state from "@/features/agents/infrastructure/stateClient";
import * as store from "@/features/agents/infrastructure/agentStore";
import { submitAgentVenueExecution } from "@/features/agents/infrastructure/executionClient";
import { runAgentAutonomyTickClient } from "@/features/agents/infrastructure/autonomyClient";
import { setupAgentBetaDemo } from "@/features/agents/infrastructure/demoClient";
import { buildAgentScoutReports, type AgentExecutionRecord, type AgentProfile, type AgentSessionGrant, type AgentTradeProposal, type AgentPolicyEvaluation, type AgentVaultPolicy } from "@/features/agents/domain/runtime";

const { updateTypedSession } = vi.hoisted(() => ({ updateTypedSession: vi.fn() }));
vi.mock("@/features/agents/infrastructure/sessionGrantClient", () => ({
  useAgentTypedSessionGrant: () => updateTypedSession,
}));
vi.mock("@/features/agents/infrastructure/demoClient", () => ({ setupAgentBetaDemo: vi.fn() }));
vi.mock("@/features/agents/infrastructure/stateClient");
vi.mock("@/features/agents/infrastructure/agentStore");
vi.mock("@/features/agents/infrastructure/executionClient", () => ({
  submitAgentVenueExecution: vi.fn(),
}));
vi.mock("@/features/agents/infrastructure/autonomyClient", () => ({
  runAgentAutonomyTickClient: vi.fn(),
}));

type Context = Parameters<typeof useAgentDashboardActions>[0];
type Actions = ReturnType<typeof useAgentDashboardActions>;
const proposal: AgentTradeProposal = {
  id: "proposal-1", walletName: "vault", agentId: "agent-1", venue: "mock_perps",
  market: "BTC-PERP", side: "long", orderType: "market", notionalUsd: "100", leverage: 1,
  confidence: 70, expiresAt: 2_000_000_000_000, status: "needs_approval",
  createdAt: 1, updatedAt: 1, version: 1,
};
const execution: AgentExecutionRecord = {
  id: "execution-1", walletName: "vault", proposalId: proposal.id, agentId: proposal.agentId,
  venue: "mock_perps", market: proposal.market, side: "long", orderType: "market",
  notionalUsd: "100", leverage: 1, status: "open", openedAt: 1, realizedPnlUsd: "0", version: 1,
};
const session: AgentSessionGrant = {
  id: "session-1", walletName: "vault", agentId: proposal.agentId, status: "active",
  startsAt: 1, expiresAt: 2_000_000_000_000, createdAt: 1, updatedAt: 1, version: 1,
};
const agent: AgentProfile = {
  id: proposal.agentId, walletName: "vault", name: "Trader", kind: "mock", status: "active",
  createdAt: 1, updatedAt: 1, version: 1,
};
const synced = { ok: true, message: "Synced" };
const evaluation: AgentPolicyEvaluation = {
  decision: "allowed", violations: [],
  normalized: { market: "BTC-PERP", notionalUsd: 100, leverage: 1, venue: "mock_perps" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

// Render the real hook with React; capture the transition's returned work without a DOM.
// React 19 can keep a transition pending only when its scope returns that promise.
function dashboard(overrides: Partial<Context> = {}) {
  const transitions: unknown[] = [];
  const context: Context = {
    agents: [agent], approveTypedAgentClearSign: vi.fn(), automaticExitDecisions: [],
    encoded: "vault", executions: [execution], name: "vault", openExecutionRecords: [execution],
    policy: null, proposals: [proposal], refreshBackendState: vi.fn(async () => {}),
    router: { push: vi.fn() }, sessions: [session], setExecutions: vi.fn(),
    setKillSwitchHandoff: vi.fn(), setLiveVenueReadiness: vi.fn(), setPolicy: vi.fn(),
    startAction: vi.fn((scope) => { transitions.push(scope()); }),
    toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), dismiss: vi.fn() },
    ...overrides,
  };
  let actions!: Actions;
  function Harness() {
    actions = useAgentDashboardActions(context);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return { actions, context, transitions };
}

beforeEach(() => { vi.resetAllMocks(); });

describe("agent dashboard action lifecycle", () => {
  it("keeps a scan pending through backend refresh and ignores same-tick repeats", async () => {
    const scan = deferred<Awaited<ReturnType<typeof runAgentAutonomyTickClient>>>();
    const refresh = deferred<void>();
    vi.mocked(runAgentAutonomyTickClient).mockReturnValue(scan.promise);
    const { actions, context, transitions } = dashboard({ refreshBackendState: vi.fn(() => refresh.promise) });

    actions.runAutonomyScan();
    actions.runAutonomyScan();
    expect(context.startAction).toHaveBeenCalledOnce();
    expect(transitions[0]).toBeInstanceOf(Promise);
    await vi.waitFor(() => expect(runAgentAutonomyTickClient).toHaveBeenCalledOnce());
    let completed = false;
    void Promise.resolve(transitions[0]).then(() => { completed = true; });
    scan.resolve({ ok: true, message: "Finished", proposals: [] });
    await vi.waitFor(() => expect(context.refreshBackendState).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    actions.runAutonomyScan();
    expect(context.startAction).toHaveBeenCalledOnce();
    refresh.resolve();
    await transitions[0];
    expect(completed).toBe(true);
  });

  it("does not overlap opposite emergency-pause updates", async () => {
    const sync = deferred<Awaited<ReturnType<typeof state.syncAgentEmergencyPause>>>();
    vi.mocked(state.syncAgentEmergencyPause).mockReturnValueOnce(sync.promise).mockResolvedValue(synced);
    const { actions, context } = dashboard();

    const stopped = actions.setKillSwitch(true);
    void actions.setKillSwitch(false);
    expect(store.setAgentVaultEmergencyPause).toHaveBeenCalledExactlyOnceWith("vault", true);
    expect(state.syncAgentEmergencyPause).toHaveBeenCalledExactlyOnceWith("vault", true);
    expect(context.startAction).not.toHaveBeenCalled();
    expect(stopped).toBeInstanceOf(Promise);
    sync.resolve(synced);
    await stopped;
    await actions.setKillSwitch(false);
    expect(state.syncAgentEmergencyPause).toHaveBeenLastCalledWith("vault", false);
  });

  it("prevents a second venue submission and releases the guard after failure", async () => {
    const submit = deferred<Awaited<ReturnType<typeof submitAgentVenueExecution>>>();
    vi.mocked(submitAgentVenueExecution).mockReturnValueOnce(submit.promise).mockResolvedValue({ ok: false, message: "Unavailable", status: 503 });
    const { actions, context, transitions } = dashboard();

    actions.submitVenueProposal(proposal.id);
    actions.submitVenueProposal(proposal.id);
    expect(submitAgentVenueExecution).toHaveBeenCalledExactlyOnceWith(proposal);
    expect(transitions[0]).toBeInstanceOf(Promise);
    submit.reject(new Error("Offline"));
    await transitions[0];
    expect(context.toast.error).toHaveBeenCalledWith("Could not check the connected practice account");
    actions.submitVenueProposal(proposal.id);
    await transitions[1];
    expect(submitAgentVenueExecution).toHaveBeenCalledTimes(2);
  });

  it("keeps approval pending through signing, synchronization and refresh", async () => {
    const approval = deferred<Awaited<ReturnType<Context["approveTypedAgentClearSign"]>>>();
    const sync = deferred<Awaited<ReturnType<typeof state.syncAgentProposalApproval>>>();
    const refresh = deferred<void>();
    const approved = { ...proposal, status: "approved" as const };
    vi.mocked(store.approveAgentProposal).mockReturnValue(approved);
    vi.mocked(state.syncAgentProposalApproval).mockReturnValue(sync.promise);
    const approveTypedAgentClearSign = vi.fn(() => approval.promise);
    const { actions, context, transitions } = dashboard({
      approveTypedAgentClearSign, refreshBackendState: vi.fn(() => refresh.promise),
    });

    actions.approveProposal(proposal.id);
    actions.approveProposal(proposal.id);
    actions.rejectProposal(proposal.id);
    expect(approveTypedAgentClearSign).toHaveBeenCalledExactlyOnceWith({
      ...proposal, status: "approved", updatedAt: expect.any(Number),
    });
    expect(store.approveAgentProposal).not.toHaveBeenCalled();
    expect(store.rejectAgentProposal).not.toHaveBeenCalled();
    expect(transitions[0]).toBeInstanceOf(Promise);
    let completed = false;
    void Promise.resolve(transitions[0]).then(() => { completed = true; });

    approval.resolve({ proposal: approved, status: "approved", proposalAddress: "test-proposal", proposalIndex: 1, intentIndex: 1 });
    await vi.waitFor(() => expect(state.syncAgentProposalApproval).toHaveBeenCalledExactlyOnceWith("vault", proposal.id));
    expect(store.saveAgentProposal).toHaveBeenCalledWith({ ...approved, clearSignV2: approved.clearSignV2 });
    expect(completed).toBe(false);
    actions.rejectProposal(proposal.id);
    expect(store.rejectAgentProposal).not.toHaveBeenCalled();
    sync.resolve(synced);
    await vi.waitFor(() => expect(context.refreshBackendState).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    refresh.resolve();
    await transitions[0];
    expect(completed).toBe(true);
  });

  it("leaves local approvals untouched when signing is cancelled and permits retry", async () => {
    const approveTypedAgentClearSign = vi.fn().mockRejectedValue(new Error("Signature cancelled"));
    const { actions, context, transitions } = dashboard({ approveTypedAgentClearSign });

    actions.approveProposal(proposal.id);
    await transitions[0];
    expect(context.toast.error).toHaveBeenCalledWith("ClearSign approval did not reach chain", { details: "Signature cancelled" });
    expect(store.approveAgentProposal).not.toHaveBeenCalled();
    expect(state.syncAgentProposalApproval).not.toHaveBeenCalled();
    actions.approveProposal(proposal.id);
    await transitions[1];
    expect(approveTypedAgentClearSign).toHaveBeenCalledTimes(2);
  });

  it.each(["renewSession", "revokeSession"] as const)("handles %s signing failures without an unhandled rejection", async (action) => {
    const onchainSession: AgentSessionGrant = {
      ...session,
      onchain: { proposalAddress: "test-proposal", proposalIndex: 1, intentIndex: 1, operation: "active", status: "executed", updatedAt: 1 },
    };
    vi.mocked(store.renewAgentSession).mockReturnValue(onchainSession);
    updateTypedSession.mockRejectedValue(new Error("Signature cancelled"));
    const { actions, context, transitions } = dashboard({ sessions: [onchainSession] });

    actions[action](session.id);
    actions[action](session.id);
    expect(updateTypedSession).toHaveBeenCalledOnce();
    await expect(transitions[0]).resolves.toBeUndefined();
    expect(context.toast.error).toHaveBeenCalledWith("Could not complete this action", { details: "Signature cancelled" });
    expect(store.saveAgentSession).not.toHaveBeenCalled();
    expect(state.syncAgentSession).not.toHaveBeenCalled();
    expect(state.syncAgentSessionStatus).not.toHaveBeenCalled();
    actions[action](session.id);
    await transitions[1];
    expect(updateTypedSession).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["reject", (actions: Actions) => actions.rejectProposal(proposal.id), () => state.syncAgentProposalRejection],
    ["execute", (actions: Actions) => actions.executeProposal(proposal.id), () => state.syncAgentExecution],
    ["recheck", (actions: Actions) => actions.recheckProposal(proposal.id), () => state.syncAgentExecution],
    ["close", (actions: Actions) => actions.closeExecution(execution.id, "0"), () => state.syncAgentExecution],
    ["update trader", (actions: Actions) => actions.setAgentStatus(agent.id, "paused"), () => state.syncAgentProfile],
    ["revoke budget", (actions: Actions) => actions.revokeSession(session.id), () => state.syncAgentSessionStatus],
    ["renew budget", (actions: Actions) => actions.renewSession(session.id), () => state.syncAgentSession],
  ] as const)("keeps %s pending through sync and refresh", async (_label, invoke, getSync) => {
    const sync = deferred<typeof synced>();
    const refresh = deferred<void>();
    vi.mocked(store.rejectAgentProposal).mockReturnValue(proposal);
    vi.mocked(store.openAgentPaperTrade).mockReturnValue({ proposal, execution, evaluation, reason: "opened" });
    vi.mocked(store.recheckAgentProposal).mockReturnValue({ proposal, execution, evaluation });
    vi.mocked(store.closeMockAgentExecution).mockReturnValue({ ...execution, status: "closed" });
    vi.mocked(store.updateAgentStatus).mockReturnValue(agent);
    vi.mocked(store.updateAgentSessionStatus).mockReturnValue({ ...session, status: "revoked" });
    vi.mocked(store.renewAgentSession).mockReturnValue(session);
    updateTypedSession.mockResolvedValue(session);
    vi.mocked(getSync()).mockReturnValue(sync.promise);
    const { actions, context, transitions } = dashboard({ refreshBackendState: vi.fn(() => refresh.promise) });

    invoke(actions);
    invoke(actions);
    expect(context.startAction).toHaveBeenCalledOnce();
    expect(transitions[0]).toBeInstanceOf(Promise);
    await vi.waitFor(() => expect(getSync()).toHaveBeenCalledOnce());
    let completed = false;
    void Promise.resolve(transitions[0]).then(() => { completed = true; });
    sync.resolve(synced);
    await vi.waitFor(() => expect(context.refreshBackendState).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    refresh.resolve();
    await transitions[0];
    expect(completed).toBe(true);
  });

  it("waits for every execution sync before releasing a batch-close action", async () => {
    const first = deferred<typeof synced>();
    const second = deferred<typeof synced>();
    vi.mocked(store.closeOpenMockAgentExecutions).mockReturnValue([
      { ...execution, status: "closed" }, { ...execution, id: "execution-2", status: "closed" },
    ]);
    vi.mocked(state.syncAgentExecution).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { actions, context, transitions } = dashboard();

    actions.closeAllOpenPaperTrades();
    actions.closeAllOpenPaperTrades();
    expect(state.syncAgentExecution).toHaveBeenCalledTimes(2);
    expect(transitions[0]).toBeInstanceOf(Promise);
    let completed = false;
    void Promise.resolve(transitions[0]).then(() => { completed = true; });
    first.resolve(synced);
    await first.promise;
    expect(context.refreshBackendState).not.toHaveBeenCalled();
    expect(completed).toBe(false);
    second.resolve(synced);
    await transitions[0];
    expect(context.refreshBackendState).toHaveBeenCalledOnce();
    expect(completed).toBe(true);
  });

  it("releases the guard after validation exits and unexpected synchronous errors", async () => {
    vi.mocked(store.setAgentVaultEmergencyPause).mockImplementationOnce(() => { throw new Error("Storage unavailable"); });
    vi.mocked(state.syncAgentEmergencyPause).mockResolvedValue(synced);
    const { actions, context, transitions } = dashboard();

    actions.submitVenueProposal("missing");
    await transitions[0];
    expect(submitAgentVenueExecution).not.toHaveBeenCalled();
    await expect(actions.setKillSwitch(true)).resolves.toBeUndefined();
    expect(context.toast.error).toHaveBeenCalledWith("Could not complete this action", { details: "Storage unavailable" });
    await actions.setKillSwitch(true);
    expect(state.syncAgentEmergencyPause).toHaveBeenCalledOnce();
  });


  it("keeps scout preparation pending through proposal sync and refresh", async () => {
    const policy: AgentVaultPolicy = {
      id: "policy-1", walletName: "vault", enabled: true, emergencyPaused: true,
      allowedVenues: ["mock_perps"], allowedMarkets: ["BTC-PERP"], maxNotionalUsd: "100",
      maxLeverage: 1, requireStopLoss: true, requireTakeProfit: true,
      maxOpenPositionsPerAgent: 1, cooldownSeconds: 0, maxSessionHours: 4,
      dailyLossCapUsd: "50", createdAt: 1, updatedAt: 1, version: 1,
    };
    const report = buildAgentScoutReports({
      agents: [agent], policy, sessions: [session], marketByMarket: {}, risksByAgent: {},
    })[0]!;
    const sync = deferred<typeof synced>();
    const refresh = deferred<void>();
    vi.mocked(store.saveAgentProposal).mockReturnValue(proposal);
    vi.mocked(state.syncAgentProposal).mockReturnValue(sync.promise);
    const { actions, context, transitions } = dashboard({ policy, refreshBackendState: vi.fn(() => refresh.promise) });

    actions.prepareScoutIdea(report);
    actions.prepareScoutIdea(report);
    expect(state.syncAgentProposal).toHaveBeenCalledOnce();
    expect(transitions[0]).toBeInstanceOf(Promise);
    let completed = false;
    void Promise.resolve(transitions[0]).then(() => { completed = true; });
    sync.resolve(synced);
    await vi.waitFor(() => expect(context.refreshBackendState).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    refresh.resolve();
    await transitions[0];
    expect(completed).toBe(true);
  });

  it("keeps automatic exits pending through execution sync and refresh", async () => {
    const sync = deferred<typeof synced>();
    const refresh = deferred<void>();
    vi.mocked(store.closeMockAgentExecution).mockReturnValue({ ...execution, status: "closed" });
    vi.mocked(state.syncAgentExecution).mockReturnValue(sync.promise);
    const { actions, context, transitions } = dashboard({
      refreshBackendState: vi.fn(() => refresh.promise),
      automaticExitDecisions: [{
        execution, proposal, reason: "take_profit", realizedPnlUsd: "5", summary: "Take profit",
        snapshot: {
          provider: "mock", source: "mock", market: "BTC-PERP", observedAt: 1, markPriceUsd: "105",
          fundingRatePct: null, openInterestUsd: null, volume24hUsd: null,
        },
      }],
    });

    actions.closeAutomaticExitTrades();
    actions.closeAutomaticExitTrades();
    expect(state.syncAgentExecution).toHaveBeenCalledOnce();
    expect(transitions[0]).toBeInstanceOf(Promise);
    let completed = false;
    void Promise.resolve(transitions[0]).then(() => { completed = true; });
    sync.resolve(synced);
    await vi.waitFor(() => expect(context.refreshBackendState).toHaveBeenCalledOnce());
    expect(completed).toBe(false);
    refresh.resolve();
    await transitions[0];
    expect(completed).toBe(true);
  });

  it("starts the demo and navigates only once for repeated clicks", async () => {
    vi.mocked(setupAgentBetaDemo).mockReturnValue({
      agent, session, firstTradeOpened: true, historyTradesCreated: 1, stoppedIdeasCreated: 0,
    });
    const { actions, context, transitions } = dashboard();

    actions.startBetaDemo();
    actions.startBetaDemo();
    expect(context.startAction).toHaveBeenCalledOnce();
    expect(transitions[0]).toBeInstanceOf(Promise);
    await transitions[0];
    expect(setupAgentBetaDemo).toHaveBeenCalledExactlyOnceWith({ walletName: "vault" });
    expect(context.router.push).toHaveBeenCalledExactlyOnceWith("/app/wallet/vault/agents/trades");
  });


  it.each(["scan", "signature"] as const)("lets emergency stop bypass a pending %s while serializing pause and resume", async (pendingWork) => {
    const scan = deferred<Awaited<ReturnType<typeof runAgentAutonomyTickClient>>>();
    const approval = deferred<Awaited<ReturnType<Context["approveTypedAgentClearSign"]>>>();
    const pause = deferred<typeof synced>();
    vi.mocked(runAgentAutonomyTickClient).mockReturnValue(scan.promise);
    vi.mocked(state.syncAgentEmergencyPause).mockReturnValueOnce(pause.promise).mockResolvedValue(synced);
    const { actions, transitions } = dashboard({ approveTypedAgentClearSign: vi.fn(() => approval.promise) });

    if (pendingWork === "scan") {
      actions.runAutonomyScan();
      await vi.waitFor(() => expect(runAgentAutonomyTickClient).toHaveBeenCalledOnce());
    } else {
      actions.approveProposal(proposal.id);
    }
    const stopped = actions.setKillSwitch(true);
    expect(state.syncAgentEmergencyPause).toHaveBeenCalledExactlyOnceWith("vault", true);
    void actions.setKillSwitch(true);
    void actions.setKillSwitch(false);
    expect(state.syncAgentEmergencyPause).toHaveBeenCalledOnce();
    pause.resolve(synced);
    await stopped;

    // Finishing the emergency pause must not allow resume while older work remains.
    await actions.setKillSwitch(false);
    expect(state.syncAgentEmergencyPause).toHaveBeenCalledOnce();
    if (pendingWork === "scan") scan.resolve({ ok: false, message: "Stopped" });
    else approval.reject(new Error("Signature cancelled"));
    await transitions[0];
    await actions.setKillSwitch(false);
    expect(state.syncAgentEmergencyPause).toHaveBeenCalledTimes(2);
    expect(state.syncAgentEmergencyPause).toHaveBeenLastCalledWith("vault", false);
  });

  it("blocks ordinary actions while emergency-pause synchronization is pending", async () => {
    const pause = deferred<typeof synced>();
    vi.mocked(state.syncAgentEmergencyPause).mockReturnValue(pause.promise);
    vi.mocked(submitAgentVenueExecution).mockResolvedValue({ ok: true, message: "Sent", status: 200 });
    const { actions, transitions } = dashboard();

    const stopped = actions.setKillSwitch(true);
    actions.submitVenueProposal(proposal.id);
    expect(submitAgentVenueExecution).not.toHaveBeenCalled();
    pause.resolve(synced);
    await stopped;
    actions.submitVenueProposal(proposal.id);
    await transitions[0];
    expect(submitAgentVenueExecution).toHaveBeenCalledOnce();
  });

});


describe("emergency pause communication", () => {
  it("does not equate a successful policy sync with external position closure", async () => {
    vi.mocked(state.syncAgentEmergencyPause).mockResolvedValue({ ...synced, killSwitch: { venue: "hyperliquid_testnet", state: "not_configured", message: "Execution bridge gated." } });
    const { actions, context } = dashboard();
    await actions.setKillSwitch(true);
    expect(context.toast.success).toHaveBeenCalledWith("ClearSig automatic actions paused", { details: expect.stringContaining("External positions and orders are not confirmed closed or cancelled") });
    expect(context.toast.success).toHaveBeenCalledWith(expect.any(String), { details: expect.stringContaining("Execution bridge gated.") });
  });
  it("keeps unsynced pause local and resume subject to the other gates", async () => {
    vi.mocked(state.syncAgentEmergencyPause).mockResolvedValueOnce({ ok: false, message: "Offline" }).mockResolvedValueOnce(synced);
    const { actions, context } = dashboard();
    await actions.setKillSwitch(true);
    expect(context.toast.success).not.toHaveBeenCalled();
    expect(context.toast.info).toHaveBeenCalledWith("This change is saved on this device for now", { details: expect.stringContaining("not confirmed closed") });
    await actions.setKillSwitch(false);
    expect(context.toast.success).toHaveBeenCalledWith("ClearSig pause removed", { details: expect.stringContaining("execution gates still apply") });
  });
});
