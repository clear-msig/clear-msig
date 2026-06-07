import { describe, expect, it } from "vitest";
import { summarizeAgentTradePerformance } from "@/lib/agents/tradePerformance";
import type { AgentExecutionRecord } from "@/lib/agents/types";
import type { AgentMarketDataSnapshot } from "@/lib/agents/marketData";

describe("agent trade performance summary", () => {
  it("combines realized and estimated open PnL", () => {
    const summary = summarizeAgentTradePerformance(
      [
        execution({ id: "open-long", status: "open", entryPrice: "100" }),
        execution({
          id: "closed",
          status: "closed",
          closedAt: 2,
          realizedPnlUsd: "12.5",
        }),
      ],
      {
        "BTC-PERP": snapshot("110"),
      },
    );

    expect(summary.totalTrades).toBe(2);
    expect(summary.openTrades).toBe(1);
    expect(summary.closedTrades).toBe(1);
    expect(summary.pricedOpenTrades).toBe(1);
    expect(summary.estimatedOpenPnlUsd).toBe("25");
    expect(summary.combinedPnlUsd).toBe("37.5");
  });
});

function execution(
  overrides: Partial<AgentExecutionRecord>,
): AgentExecutionRecord {
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
    openedAt: 1,
    realizedPnlUsd: "0",
    version: 1,
    ...overrides,
  };
}

function snapshot(markPriceUsd: string): AgentMarketDataSnapshot {
  return {
    provider: "mock",
    source: "mock",
    market: "BTC-PERP",
    observedAt: 1,
    markPriceUsd,
    fundingRatePct: null,
    openInterestUsd: null,
    volume24hUsd: null,
  };
}
