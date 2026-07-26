import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAgents,
  listAgentExecutions,
  listAgentProposals,
  seedClearSigAgentDemoHistory,
} from "@/lib/agents";

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 5, 6, 12, 0, 0));
  const localStorage = makeLocalStorageStub();
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("ClearSig demo history", () => {
  it("adds prepared agents, closed trades, and stopped ideas without duplicating trades", () => {
    const first = seedClearSigAgentDemoHistory({
      walletName: "demo-wallet",
      now: Date.UTC(2026, 5, 6, 12, 0, 0),
    });
    const second = seedClearSigAgentDemoHistory({
      walletName: "demo-wallet",
      now: Date.UTC(2026, 5, 6, 12, 5, 0),
    });

    expect(first.agentsCreated).toBe(3);
    expect(first.tradesCreated).toBeGreaterThan(0);
    expect(first.stoppedIdeasCreated).toBe(3);
    expect(second.tradesCreated).toBe(0);
    expect(listAgents("demo-wallet")).toHaveLength(3);
    expect(listAgentExecutions("demo-wallet").every((execution) => execution.status === "closed")).toBe(true);
    expect(
      listAgentProposals("demo-wallet").filter((proposal) => proposal.status === "blocked"),
    ).toHaveLength(3);
  });
});
