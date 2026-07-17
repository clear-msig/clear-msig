import { describe, expect, it } from "vitest";
import {
  buildAgentMarketIntelligenceSnapshot,
  normalizeAgentMarketIntelligenceItems,
  summarizeMacroForScout,
  summarizeNewsForScout,
  type AgentMarketDataSnapshot,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent market intelligence", () => {
  it("builds provider-neutral coverage from market, news, and macro inputs", () => {
    const snapshot = buildAgentMarketIntelligenceSnapshot({
      marketData: marketData(),
      items: [
        {
          id: "news-1",
          kind: "news",
          label: "ETF flow",
          summary: "BTC ETF inflows improved during the US session.",
          source: "news-provider",
          impact: "bullish",
          observedAt: now,
        },
        {
          id: "macro-1",
          kind: "macro",
          label: "Dollar index",
          summary: "DXY softened after weaker macro data.",
          source: "macro-provider",
          impact: "bullish",
          observedAt: now,
        },
      ],
      now,
    });

    expect(snapshot.coverage).toMatchObject({
      marketData: true,
      funding: true,
      liquidity: true,
      news: true,
      macro: true,
    });
    expect(snapshot.summary).toContain("BTC-PERP mark");
    expect(summarizeNewsForScout(snapshot)).toContain("ETF flow");
    expect(summarizeMacroForScout(snapshot)).toContain("Dollar index");
  });

  it("normalizes configured JSON feeds and filters unrelated assets", () => {
    const items = normalizeAgentMarketIntelligenceItems(
      {
        items: [
          {
            id: "btc-news",
            market: "BTC-PERP",
            title: "BTC launch",
            summary: "A new BTC market structure headline.",
            source: "feed",
            impact: "bullish",
            publishedAt: new Date(now).toISOString(),
          },
          {
            id: "eth-news",
            market: "ETH-PERP",
            title: "ETH headline",
            summary: "Different market.",
          },
        ],
      },
      { market: "BTC-PERP", kind: "news", source: "configured", now },
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "btc-news",
      kind: "news",
      label: "BTC launch",
      impact: "bullish",
    });
  });

  it("shows coverage gaps without marking news and macro as connected", () => {
    const snapshot = buildAgentMarketIntelligenceSnapshot({
      marketData: marketData(),
      items: [
        {
          id: "gap-news",
          kind: "news",
          label: "BTC news feed not connected",
          summary: "No external news provider is configured.",
          source: "coverage-gap",
          impact: "neutral",
          observedAt: now,
        },
        {
          id: "gap-macro",
          kind: "macro",
          label: "Macro feed not connected",
          summary: "No external macro provider is configured.",
          source: "coverage-gap",
          impact: "neutral",
          observedAt: now,
        },
      ],
      now,
    });

    expect(snapshot.items.some((item) => item.source === "coverage-gap")).toBe(true);
    expect(snapshot.coverage.news).toBe(false);
    expect(snapshot.coverage.macro).toBe(false);
    expect(snapshot.summary).toContain("news feed not connected");
    expect(summarizeNewsForScout(snapshot)).toContain("not connected");
  });
});

function marketData(): AgentMarketDataSnapshot {
  return {
    provider: "hyperliquid",
    source: "live",
    market: "BTC-PERP",
    observedAt: now,
    markPriceUsd: "70000",
    fundingRatePct: "0.01",
    openInterestUsd: "2000000",
    volume24hUsd: "5000000",
  };
}
