import { describe, expect, it } from "vitest";
import {
  agentMarketDataFreshnessError,
  estimateAgentOpenTradePerformance,
  normalizeAgentMarket,
  normalizeAgentMarketCandleInterval,
  normalizeAgentMarketDataSnapshot,
  type AgentExecutionRecord,
  type AgentMarketDataSnapshot,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 4, 12, 0, 0);

describe("agent market data", () => {
  it("normalizes safe perpetual market symbols", () => {
    expect(normalizeAgentMarket(" btc-perp ")).toBe("BTC-PERP");
    expect(normalizeAgentMarket("../btc")).toBeNull();
    expect(normalizeAgentMarket("")).toBeNull();
  });

  it("normalizes supported candle intervals", () => {
    expect(normalizeAgentMarketCandleInterval("1m")).toBe("1m");
    expect(normalizeAgentMarketCandleInterval("1h")).toBe("1h");
    expect(normalizeAgentMarketCandleInterval("2h")).toBeNull();
  });

  it("validates a structured provider snapshot", () => {
    const result = normalizeAgentMarketDataSnapshot({
      provider: "mock",
      source: "mock",
      market: "btc-perp",
      observedAt: now,
      markPriceUsd: "67500",
      fundingRatePct: "0.01",
      openInterestUsd: "18500000000",
      volume24hUsd: "32000000000",
    });

    expect(result.errors).toEqual([]);
    expect(result.snapshot?.market).toBe("BTC-PERP");
    expect(result.snapshot?.markPriceUsd).toBe("67500");
  });

  it("rejects malformed snapshots and stale data", () => {
    const malformed = normalizeAgentMarketDataSnapshot({
      provider: "unknown",
      source: "live",
      market: "",
      observedAt: 0,
      markPriceUsd: "-1",
    });

    expect(malformed.snapshot).toBeNull();
    expect(malformed.errors).toEqual(
      expect.arrayContaining([
        "Market data provider is unsupported.",
        "Market is missing or invalid.",
        "Observed timestamp is missing or invalid.",
        "Mark price must be greater than zero.",
      ]),
    );

    expect(
      agentMarketDataFreshnessError(
        {
          provider: "mock",
          source: "mock",
          market: "BTC-PERP",
          observedAt: now - 61_000,
          markPriceUsd: "67500",
          fundingRatePct: null,
          openInterestUsd: null,
          volume24hUsd: null,
        },
        { now, maxAgeMs: 60_000 },
      ),
    ).toBe("Market data snapshot is stale.");
  });

  it("estimates open trade performance from entry and mark price", () => {
    const snapshot: AgentMarketDataSnapshot = {
      provider: "mock",
      source: "mock",
      market: "BTC-PERP",
      observedAt: now,
      markPriceUsd: "70400",
      fundingRatePct: null,
      openInterestUsd: null,
      volume24hUsd: null,
    };

    expect(
      estimateAgentOpenTradePerformance(
        execution({ side: "long", entryPrice: "70000", notionalUsd: "350" }),
        snapshot,
      )?.unrealizedPnlUsd,
    ).toBe("2");

    expect(
      estimateAgentOpenTradePerformance(
        execution({ side: "short", entryPrice: "70000", notionalUsd: "350" }),
        snapshot,
      )?.unrealizedPnlUsd,
    ).toBe("-2");
  });

  it("does not estimate closed, missing-entry, or wrong-market trades", () => {
    const snapshot: AgentMarketDataSnapshot = {
      provider: "mock",
      source: "mock",
      market: "ETH-PERP",
      observedAt: now,
      markPriceUsd: "4000",
      fundingRatePct: null,
      openInterestUsd: null,
      volume24hUsd: null,
    };

    expect(estimateAgentOpenTradePerformance(execution({}), snapshot)).toBeNull();
    expect(
      estimateAgentOpenTradePerformance(
        execution({ status: "closed", entryPrice: "4000" }),
        snapshot,
      ),
    ).toBeNull();
  });
});

function execution(overrides: Partial<AgentExecutionRecord>): AgentExecutionRecord {
  return {
    id: "execution-1",
    walletName: "vault",
    proposalId: "proposal-1",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "350",
    leverage: 1,
    entryPrice: null,
    status: "open",
    openedAt: now,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
    ...overrides,
  };
}
