import { describe, expect, it } from "vitest";
import {
  agentMarketDataFreshnessError,
  normalizeAgentMarket,
  normalizeAgentMarketDataSnapshot,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 4, 12, 0, 0);

describe("agent market data", () => {
  it("normalizes safe perpetual market symbols", () => {
    expect(normalizeAgentMarket(" btc-perp ")).toBe("BTC-PERP");
    expect(normalizeAgentMarket("../btc")).toBeNull();
    expect(normalizeAgentMarket("")).toBeNull();
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
});
