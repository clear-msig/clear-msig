"use client";

import type { AgentMarketDataSnapshot } from "@/lib/agents/marketData";
import type { AgentMarketIntelligenceSnapshot } from "@/lib/agents/marketIntelligence";

export async function loadAgentMarketDataSnapshot(
  market: string,
): Promise<AgentMarketDataSnapshot | null> {
  for (const provider of ["hyperliquid", "mock"]) {
    try {
      const response = await fetch(
        `/api/agent-market-data/${provider}?market=${encodeURIComponent(market)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        snapshot?: AgentMarketDataSnapshot;
      };
      if (response.ok && payload.ok && payload.snapshot) {
        return payload.snapshot;
      }
    } catch {
      // Try the fallback provider.
    }
  }
  return null;
}

export async function loadAgentMarketDataSnapshots(
  markets: string[],
): Promise<Record<string, AgentMarketDataSnapshot>> {
  const uniqueMarkets = Array.from(
    new Set(markets.map((market) => market.trim().toUpperCase()).filter(Boolean)),
  );
  const entries = await Promise.all(
    uniqueMarkets.map(async (market) => {
      const snapshot = await loadAgentMarketDataSnapshot(market);
      return [market, snapshot] as const;
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, AgentMarketDataSnapshot] =>
      Boolean(entry[1]),
    ),
  );
}

export async function loadAgentMarketIntelligenceSnapshot(
  market: string,
): Promise<AgentMarketIntelligenceSnapshot | null> {
  for (const provider of ["hyperliquid", "mock"]) {
    try {
      const response = await fetch(
        `/api/agent-market-data/${provider}?market=${encodeURIComponent(market)}&include=intelligence`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        intelligence?: AgentMarketIntelligenceSnapshot;
      };
      if (response.ok && payload.ok && payload.intelligence) {
        return payload.intelligence;
      }
    } catch {
      // Try the fallback provider.
    }
  }
  return null;
}

export async function loadAgentMarketIntelligenceSnapshots(
  markets: string[],
): Promise<Record<string, AgentMarketIntelligenceSnapshot>> {
  const uniqueMarkets = Array.from(
    new Set(markets.map((market) => market.trim().toUpperCase()).filter(Boolean)),
  );
  const entries = await Promise.all(
    uniqueMarkets.map(async (market) => {
      const snapshot = await loadAgentMarketIntelligenceSnapshot(market);
      return [market, snapshot] as const;
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, AgentMarketIntelligenceSnapshot] =>
      Boolean(entry[1]),
    ),
  );
}
