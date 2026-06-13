import { afterEach, describe, expect, it, vi } from "vitest";
import { importAgentInboxSignalsOnServer } from "@/lib/agents/clientInbox";
import {
  loadAgentBackendState,
  syncAgentEmergencyPause,
  syncAgentExecution,
  syncAgentProfile,
  syncAgentProposalApproval,
} from "@/lib/agents/clientState";
import type { AgentProfile } from "@/lib/agents/types";
import type { AgentExecutionRecord } from "@/lib/agents/types";

const agent: AgentProfile = {
  id: "agent-alpha",
  walletName: "vault-client-state",
  name: "Agent Alpha",
  kind: "mock",
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  version: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent client backend state adapter", () => {
  it("loads backend state snapshots", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        storage: "memory",
        state: {
          walletName: "vault-client-state",
          agents: [agent],
          policy: {},
          proposals: [],
          sessions: [],
          events: [],
          scorecards: {},
          updatedAt: 1,
          version: 1,
        },
        leaderboard: [],
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await loadAgentBackendState("vault-client-state");

    expect(result.ok).toBe(true);
    expect(result.value?.storage).toBe("memory");
    expect(result.value?.state.agents).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent-state/vault-client-state",
      expect.objectContaining({ method: "GET" }),
    );
  });

  it("posts agent state actions", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        agent,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await syncAgentProfile(agent);

    expect(result.ok).toBe(true);
    expect(result.value?.id).toBe(agent.id);
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent-state/vault-client-state",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "upsert_agent", payload: agent }),
      }),
    );
  });

  it("posts execution state actions", async () => {
    const execution: AgentExecutionRecord = {
      id: "execution-1",
      walletName: "vault-client-state",
      proposalId: "proposal-1",
      agentId: "agent-alpha",
      venue: "mock_perps",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      status: "open",
      openedAt: 1,
      closedAt: null,
      realizedPnlUsd: "0",
      version: 1,
    };
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        execution,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await syncAgentExecution(execution);

    expect(result.ok).toBe(true);
    expect(result.value?.id).toBe(execution.id);
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent-state/vault-client-state",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "upsert_execution", payload: execution }),
      }),
    );
  });

  it("returns a non-throwing failure when sync is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Forbidden." }, { status: 403 }),
      ),
    );

    const result = await syncAgentProposalApproval(
      "vault-client-state",
      "proposal-1",
    );

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Forbidden.");
  });

  it("returns protected executor kill-switch handoff details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          ok: true,
          policy: { walletName: "vault-client-state", emergencyPaused: true },
          killSwitch: {
            venue: "hyperliquid_testnet",
            state: "sent",
            message: "Open orders cancelled.",
            artifact: {
              exchange: "hyperliquid_testnet",
              status: "cancelled",
              cancelledAt: 1,
              message: "Open orders cancelled.",
            },
          },
        }),
      ),
    );

    const result = await syncAgentEmergencyPause("vault-client-state", true);

    expect(result.ok).toBe(true);
    expect(result.killSwitch?.state).toBe("sent");
    expect(result.killSwitch?.message).toBe("Open orders cancelled.");
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent-state/vault-client-state",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "set_emergency_pause",
          payload: { emergencyPaused: true },
        }),
      }),
    );
  });

  it("posts inbox import actions with the management key", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        storage: "memory",
        imported: [],
        skipped: [],
        removed: 0,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await importAgentInboxSignalsOnServer({
      walletName: "vault-client-state",
      agentId: "agent-alpha",
      managementKey: "cs_mgmt_test",
      ids: ["signal-1"],
      allowedOnly: true,
    });

    expect(result.storage).toBe("memory");
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent-signals/vault-client-state/agent-alpha",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "x-clearsig-management-key": "cs_mgmt_test",
        }),
        body: JSON.stringify({
          action: "import",
          ids: ["signal-1"],
          allowedOnly: true,
        }),
      }),
    );
  });
});
