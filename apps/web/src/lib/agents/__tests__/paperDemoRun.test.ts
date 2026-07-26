import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listAgentEvents,
  listAgentExecutions,
  runAgentPaperTradingDemo,
} from "@/lib/agents";

const now = Date.UTC(2026, 6, 7, 10, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  stubBrowserStorage();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("agent paper trading demo run", () => {
  it("returns a complete receipt for the repeatable paper-trading loop", () => {
    const result = runAgentPaperTradingDemo({
      walletName: "demo-vault",
      now,
      realizedPnlUsd: "15.75",
    });

    expect(result.closedExecution).toMatchObject({
      status: "closed",
      realizedPnlUsd: "15.75",
      executionMode: "paper",
    });
    expect(result.scorecard?.executed).toBeGreaterThan(0);
    expect(result.scorecard?.realizedPnlUsd).toBe("15.75");
    expect(result.leaderboardEntry?.agentId).toBe(result.agentId);
    expect(result.checklist.every((item) => item.passed)).toBe(true);
    expect(listAgentEvents("demo-vault").map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "proposal_created",
        "proposal_executed",
        "execution_opened",
        "execution_closed",
      ]),
    );
  });

  it("can be rerun without duplicating the first beta paper trade", () => {
    runAgentPaperTradingDemo({ walletName: "demo-vault", now });
    const firstTradeCount = betaFirstTrades("demo-vault").length;
    const second = runAgentPaperTradingDemo({ walletName: "demo-vault", now: now + 60_000 });

    expect(firstTradeCount).toBe(1);
    expect(betaFirstTrades("demo-vault")).toHaveLength(1);
    expect(second.closedExecution?.status).toBe("closed");
    expect(second.checklist.every((item) => item.passed)).toBe(true);
  });
});

function betaFirstTrades(walletName: string) {
  return listAgentExecutions(walletName).filter((execution) =>
    execution.proposalId.startsWith("clearsig-beta-demo:first-trade"),
  );
}

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
