import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupAgentBetaDemo } from "@/lib/agents/betaDemoSetup";
import {
  getAgentVaultPolicy,
  listAgentExecutions,
  listAgentSessions,
} from "@/lib/agents/storage";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  stubBrowserStorage();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent beta demo setup", () => {
  it("creates a safe policy, allowance, and first open paper trade", () => {
    const result = setupAgentBetaDemo({ walletName: "vault", now });

    expect(result.agent.id).toBe("clearsig-beta-demo:steady-btc");
    expect(result.session.status).toBe("active");
    expect(result.firstTradeOpened).toBe(true);
    expect(getAgentVaultPolicy("vault").maxNotionalUsd).toBe("250");
    expect(
      listAgentSessions("vault").some(
        (session) => session.id === "clearsig-beta-demo:steady-btc:allowance",
      ),
    ).toBe(true);
    expect(listAgentExecutions("vault").some((execution) => execution.status === "open")).toBe(
      true,
    );
  });

  it("is idempotent for the first open beta trade", () => {
    setupAgentBetaDemo({ walletName: "vault", now });
    setupAgentBetaDemo({ walletName: "vault", now: now + 1 });

    expect(
      listAgentExecutions("vault").filter(
        (execution) =>
          execution.status === "open" &&
          execution.proposalId.startsWith("clearsig-beta-demo:first-trade"),
      ),
    ).toHaveLength(1);
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
