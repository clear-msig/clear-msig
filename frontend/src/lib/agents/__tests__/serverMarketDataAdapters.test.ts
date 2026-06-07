import { describe, expect, it } from "vitest";
import {
  fetchAgentMarketData,
  serverAgentMarketDataReadiness,
} from "@/lib/agents";

describe("server agent market-data adapters", () => {
  it("returns deterministic mock market data", async () => {
    const snapshot = await fetchAgentMarketData({
      provider: "mock",
      market: "btc-perp",
      now: 1_780_000_000_000,
    });

    expect(snapshot).toEqual({
      provider: "mock",
      source: "mock",
      market: "BTC-PERP",
      observedAt: 1_780_000_000_000,
      markPriceUsd: "67500",
      fundingRatePct: "0.0100",
      openInterestUsd: "18500000000",
      volume24hUsd: "32000000000",
    });
  });

  it("keeps live provider data behind an unconnected backend adapter", async () => {
    expect(serverAgentMarketDataReadiness("hyperliquid").state).toBe("ready");
    const snapshot = await fetchAgentMarketData({
      provider: "hyperliquid",
      market: "BTC-PERP",
      now: 1_780_000_000_000,
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              universe: [
                { name: "BTC", szDecimals: 5, maxLeverage: 40 },
                { name: "ETH", szDecimals: 4, maxLeverage: 25 },
              ],
            },
            [
              {
                markPx: "67500",
                funding: "0.0001",
                openInterest: "100",
                dayNtlVlm: "32000000",
              },
              {
                markPx: "3850",
                funding: "0.00008",
                openInterest: "200",
                dayNtlVlm: "14000000",
              },
            ],
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    expect(snapshot).toEqual({
      provider: "hyperliquid",
      source: "live",
      market: "BTC-PERP",
      observedAt: 1_780_000_000_000,
      markPriceUsd: "67500",
      fundingRatePct: "0.01",
      openInterestUsd: "6750000",
      volume24hUsd: "32000000",
    });
  });

  it("rejects markets absent from the deterministic demo feed", async () => {
    await expect(
      fetchAgentMarketData({ provider: "mock", market: "DOGE-PERP" }),
    ).rejects.toThrow("not available");
  });

  it("rejects malformed Hyperliquid metadata", async () => {
    await expect(
      fetchAgentMarketData({
        provider: "hyperliquid",
        market: "BTC-PERP",
        fetchImpl: async () =>
          new Response(JSON.stringify({ universe: [] }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
    ).rejects.toThrow("malformed");
  });
});
