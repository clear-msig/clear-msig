import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAgentBetaDemo } from "@/lib/agents/betaDemoSetup";
import { setAgentAutomaticTrading } from "@/lib/agents/clientInbox";
import {
  getAgentConnectionKit,
  getAgentVaultPolicy,
  listAgentExecutions,
  listAgentSessions,
  listAgents,
  listAgentProposals,
  setAgentVaultEmergencyPause,
} from "@/features/agents/local-state/store";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  stubBrowserStorage();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, signals: [], storage: "memory" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Agent product flow", () => {
  it("keeps the Agent vault flow distinct from generic wallet setup", async () => {
    const walletName = "Agent vault#flow";
    const result = setupAgentBetaDemo({ walletName, now });

    expect(listAgents(walletName).some((agent) => agent.id === result.agent.id)).toBe(true);
    expect(result.agent.strategy?.executionProtocol).toContain("practice");

    const policy = getAgentVaultPolicy(walletName);
    expect(policy.enabled).toBe(true);
    expect(policy.allowedVenues).toContain("mock_perps");
    expect(policy.maxNotionalUsd).toBe("250");

    const sessions = listAgentSessions(walletName);
    expect(sessions.some((session) => session.status === "active")).toBe(true);

    const proposals = listAgentProposals(walletName);
    const executions = listAgentExecutions(walletName);
    expect(proposals.some((proposal) => proposal.status === "executed")).toBe(true);
    expect(executions.some((execution) => execution.status === "open")).toBe(true);

    await setAgentAutomaticTrading(walletName, result.agent.id, true);
    expect(
      getAgentConnectionKit(walletName, result.agent.id).autoImportSessionSignals,
    ).toBe(true);

    const paused = setAgentVaultEmergencyPause(walletName, true);
    expect(paused.emergencyPaused).toBe(true);
  });
});

function stubBrowserStorage() {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      clear: () => store.clear(),
    },
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as never);
}
