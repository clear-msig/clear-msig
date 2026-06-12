import { describe, expect, it } from "vitest";
import {
  fetchAgentMarketData,
  fetchAgentMarketIntelligence,
  fetchAgentMarketUniverse,
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

  it("lists live Hyperliquid perp markets for autonomous scanning", async () => {
    const markets = await fetchAgentMarketUniverse({
      provider: "hyperliquid",
      now: 1_780_000_000_000,
      limit: 2,
      fetchImpl: async () =>
        new Response(
          JSON.stringify([
            {
              universe: [
                { name: "BTC", szDecimals: 5, maxLeverage: 40 },
                { name: "ETH", szDecimals: 4, maxLeverage: 25 },
                { name: "OLD", isDelisted: true },
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
              {
                markPx: "1",
                funding: "0",
                openInterest: "10",
                dayNtlVlm: "1",
              },
            ],
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    expect(markets).toEqual([
      {
        provider: "hyperliquid",
        source: "live",
        market: "BTC-PERP",
        baseAsset: "BTC",
        observedAt: 1_780_000_000_000,
        markPriceUsd: "67500",
        fundingRatePct: "0.01",
        openInterestUsd: "6750000",
        volume24hUsd: "32000000",
        tradable: true,
      },
      {
        provider: "hyperliquid",
        source: "live",
        market: "ETH-PERP",
        baseAsset: "ETH",
        observedAt: 1_780_000_000_000,
        markPriceUsd: "3850",
        fundingRatePct: "0.008",
        openInterestUsd: "770000",
        volume24hUsd: "14000000",
        tradable: true,
      },
    ]);
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

  it("combines configured news and macro feeds with market data", async () => {
    const previousNews = process.env.CLEARSIG_AGENT_NEWS_JSON_URL;
    const previousMacro = process.env.CLEARSIG_AGENT_MACRO_JSON_URL;
    process.env.CLEARSIG_AGENT_NEWS_JSON_URL = "https://feeds.example/news.json";
    process.env.CLEARSIG_AGENT_MACRO_JSON_URL = "https://feeds.example/macro.json";
    try {
      const intelligence = await fetchAgentMarketIntelligence({
        provider: "mock",
        market: "BTC-PERP",
        now: 1_780_000_000_000,
        fetchImpl: async (input) =>
          new Response(
            JSON.stringify({
              items: [
                {
                  market: "BTC-PERP",
                  title: String(input).includes("macro") ? "DXY softer" : "BTC ETF flow",
                  summary: String(input).includes("macro")
                    ? "Macro backdrop improved."
                    : "ETF inflows improved.",
                  impact: "bullish",
                  publishedAt: 1_780_000_000_000,
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      });

      expect(intelligence.coverage.news).toBe(true);
      expect(intelligence.coverage.macro).toBe(true);
      expect(intelligence.items.some((item) => item.label === "BTC ETF flow")).toBe(true);
      expect(intelligence.items.some((item) => item.label === "DXY softer")).toBe(true);
    } finally {
      if (previousNews == null) delete process.env.CLEARSIG_AGENT_NEWS_JSON_URL;
      else process.env.CLEARSIG_AGENT_NEWS_JSON_URL = previousNews;
      if (previousMacro == null) delete process.env.CLEARSIG_AGENT_MACRO_JSON_URL;
      else process.env.CLEARSIG_AGENT_MACRO_JSON_URL = previousMacro;
    }
  });

  it("returns visible coverage gaps for live market data when feeds are not configured", async () => {
    const previousNews = process.env.CLEARSIG_AGENT_NEWS_JSON_URL;
    const previousMacro = process.env.CLEARSIG_AGENT_MACRO_JSON_URL;
    delete process.env.CLEARSIG_AGENT_NEWS_JSON_URL;
    delete process.env.CLEARSIG_AGENT_MACRO_JSON_URL;
    try {
      const intelligence = await fetchAgentMarketIntelligence({
        provider: "hyperliquid",
        market: "BTC-PERP",
        now: 1_780_000_000_000,
        fetchImpl: async () =>
          new Response(
            JSON.stringify([
              { universe: [{ name: "BTC", szDecimals: 5, maxLeverage: 40 }] },
              [
                {
                  markPx: "67500",
                  funding: "0.0001",
                  openInterest: "100",
                  dayNtlVlm: "32000000",
                },
              ],
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      });

      expect(intelligence.items.some((item) => item.source === "coverage-gap")).toBe(true);
      expect(intelligence.coverage.news).toBe(false);
      expect(intelligence.coverage.macro).toBe(false);
      expect(intelligence.summary).toContain("news feed not connected");
    } finally {
      if (previousNews == null) delete process.env.CLEARSIG_AGENT_NEWS_JSON_URL;
      else process.env.CLEARSIG_AGENT_NEWS_JSON_URL = previousNews;
      if (previousMacro == null) delete process.env.CLEARSIG_AGENT_MACRO_JSON_URL;
      else process.env.CLEARSIG_AGENT_MACRO_JSON_URL = previousMacro;
    }
  });
});
