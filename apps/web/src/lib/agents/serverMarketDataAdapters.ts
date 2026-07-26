import {
  normalizeAgentMarket,
  normalizeAgentMarketCandleInterval,
  type AgentMarketCandle,
  type AgentMarketCandleInterval,
  type AgentMarketDataProviderId,
  type AgentMarketDataSnapshot,
  type AgentMarketUniverseItem,
} from "@/lib/agents/marketData";
import {
  buildAgentMarketIntelligenceSnapshot,
  normalizeAgentMarketIntelligenceItems,
  type AgentMarketIntelligenceItem,
  type AgentMarketIntelligenceSnapshot,
} from "@/lib/agents/marketIntelligence";

export type AgentMarketDataAdapterState = "ready" | "not_connected";

export interface AgentMarketDataReadiness {
  provider: AgentMarketDataProviderId;
  label: string;
  state: AgentMarketDataAdapterState;
  source: "mock" | "live";
  message: string;
}

const MOCK_MARKETS: Record<
  string,
  Pick<
    AgentMarketDataSnapshot,
    "markPriceUsd" | "fundingRatePct" | "openInterestUsd" | "volume24hUsd"
  >
> = {
  "BTC-PERP": {
    markPriceUsd: "67500",
    fundingRatePct: "0.0100",
    openInterestUsd: "18500000000",
    volume24hUsd: "32000000000",
  },
  "ETH-PERP": {
    markPriceUsd: "3850",
    fundingRatePct: "0.0080",
    openInterestUsd: "9200000000",
    volume24hUsd: "14000000000",
  },
  "SOL-PERP": {
    markPriceUsd: "172",
    fundingRatePct: "0.0120",
    openInterestUsd: "2100000000",
    volume24hUsd: "4800000000",
  },
};

const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";
const MARKET_DATA_TIMEOUT_MS = 12_000;
const CANDLE_INTERVAL_MS: Record<AgentMarketCandleInterval, number> = {
  "1m": 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
};

export function serverAgentMarketDataReadiness(
  provider: AgentMarketDataProviderId,
): AgentMarketDataReadiness {
  if (provider === "mock") {
    return {
      provider,
      label: "Deterministic mock market data",
      state: "ready",
      source: "mock",
      message: "Mock prices, funding, open interest, and volume are ready.",
    };
  }
  return {
    provider,
    label: "Hyperliquid market data",
    state: "ready",
    source: "live",
    message: "Live public Hyperliquid perpetual market data is ready.",
  };
}

export async function fetchAgentMarketData({
  provider,
  market: marketInput,
  now = Date.now(),
  fetchImpl = fetch,
}: {
  provider: AgentMarketDataProviderId;
  market: string;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<AgentMarketDataSnapshot> {
  const market = normalizeAgentMarket(marketInput);
  if (!market) {
    throw new Error("Market is missing or invalid.");
  }

  if (provider === "hyperliquid") {
    return fetchHyperliquidMarketData({ market, now, fetchImpl });
  }

  const values = MOCK_MARKETS[market];
  if (!values) {
    throw new Error(`Mock market data is not available for ${market}.`);
  }

  return {
    provider,
    source: "mock",
    market,
    observedAt: now,
    ...values,
  };
}

export async function fetchAgentMarketUniverse({
  provider,
  now = Date.now(),
  fetchImpl = fetch,
  limit = 100,
}: {
  provider: AgentMarketDataProviderId;
  now?: number;
  fetchImpl?: typeof fetch;
  limit?: number;
}): Promise<AgentMarketUniverseItem[]> {
  if (provider === "hyperliquid") {
    return fetchHyperliquidMarketUniverse({ now, fetchImpl, limit });
  }

  return Object.entries(MOCK_MARKETS)
    .map(([market, values]) => ({
      provider,
      source: "mock" as const,
      market,
      baseAsset: hyperliquidCoinFromMarket(market),
      observedAt: now,
      tradable: true,
      ...values,
    }))
    .slice(0, limit);
}

export async function fetchAgentMarketCandles({
  provider,
  market: marketInput,
  interval: intervalInput = "1h",
  now = Date.now(),
  fetchImpl = fetch,
  limit = 24,
}: {
  provider: AgentMarketDataProviderId;
  market: string;
  interval?: string;
  now?: number;
  fetchImpl?: typeof fetch;
  limit?: number;
}): Promise<AgentMarketCandle[]> {
  const market = normalizeAgentMarket(marketInput);
  if (!market) {
    throw new Error("Market is missing or invalid.");
  }
  const interval = normalizeAgentMarketCandleInterval(intervalInput);
  if (!interval) {
    throw new Error("Market candle interval is unsupported.");
  }
  const rawLimit = Math.floor(limit);
  const boundedLimit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(250, rawLimit))
    : 24;

  if (provider === "hyperliquid") {
    return fetchHyperliquidMarketCandles({
      market,
      interval,
      now,
      fetchImpl,
      limit: boundedLimit,
    });
  }

  return mockMarketCandles({
    provider,
    market,
    interval,
    now,
    limit: boundedLimit,
  });
}

export async function fetchAgentMarketIntelligence({
  provider,
  market,
  now = Date.now(),
  fetchImpl = fetch,
}: {
  provider: AgentMarketDataProviderId;
  market: string;
  now?: number;
  fetchImpl?: typeof fetch;
}): Promise<AgentMarketIntelligenceSnapshot> {
  const marketData = await fetchAgentMarketData({ provider, market, now, fetchImpl });
  const items = await fetchConfiguredIntelligenceItems({
    market: marketData.market,
    provider,
    now,
    fetchImpl,
  });
  return buildAgentMarketIntelligenceSnapshot({
    marketData,
    items,
    now,
  });
}

async function fetchHyperliquidMarketData({
  market,
  now,
  fetchImpl,
}: {
  market: string;
  now: number;
  fetchImpl: typeof fetch;
}): Promise<AgentMarketDataSnapshot> {
  const payload = await fetchHyperliquidMetaAndAssetContexts(fetchImpl);
  const parsed = parseHyperliquidMetaAndAssetContexts(payload);
  const coin = hyperliquidCoinFromMarket(market);
  const assetIndex = parsed.universe.findIndex((asset) => asset.name === coin);
  const context = parsed.contexts[assetIndex];
  if (assetIndex < 0 || !context) {
    throw new Error(`Hyperliquid market data is not available for ${market}.`);
  }

  const markPrice = positiveDecimal(context.markPx);
  const openInterest = positiveDecimal(context.openInterest);
  const dayNotionalVolume = positiveDecimal(context.dayNtlVlm);
  const funding = decimal(context.funding);
  if (!markPrice) {
    throw new Error(`Hyperliquid returned an invalid mark price for ${market}.`);
  }

  return {
    provider: "hyperliquid",
    source: "live",
    market: `${coin}-PERP`,
    observedAt: now,
    markPriceUsd: markPrice,
    fundingRatePct: funding == null ? null : formatDecimal(Number(funding) * 100),
    openInterestUsd:
      openInterest == null
        ? null
        : formatDecimal(Number(openInterest) * Number(markPrice)),
    volume24hUsd: dayNotionalVolume,
  };
}

async function fetchHyperliquidMarketUniverse({
  now,
  fetchImpl,
  limit,
}: {
  now: number;
  fetchImpl: typeof fetch;
  limit: number;
}): Promise<AgentMarketUniverseItem[]> {
  const payload = await fetchHyperliquidMetaAndAssetContexts(fetchImpl);
  const parsed = parseHyperliquidMetaAndAssetContexts(payload);
  return parsed.universe
    .map((asset, index): AgentMarketUniverseItem | null => {
      const context = parsed.contexts[index];
      if (!context) return null;
      const markPriceUsd = positiveDecimal(context.markPx);
      const openInterest = positiveDecimal(context.openInterest);
      const volume24hUsd = positiveDecimal(context.dayNtlVlm);
      const funding = decimal(context.funding);
      return {
        provider: "hyperliquid",
        source: "live",
        market: `${asset.name}-PERP`,
        baseAsset: asset.name,
        observedAt: now,
        markPriceUsd,
        fundingRatePct: funding == null ? null : formatDecimal(Number(funding) * 100),
        openInterestUsd:
          openInterest == null || markPriceUsd == null
            ? null
            : formatDecimal(Number(openInterest) * Number(markPriceUsd)),
        volume24hUsd,
        tradable: markPriceUsd != null && !asset.isDelisted,
      };
    })
    .filter((item): item is AgentMarketUniverseItem => item != null)
    .sort((a, b) => Number(b.volume24hUsd ?? 0) - Number(a.volume24hUsd ?? 0))
    .slice(0, Math.max(1, Math.min(250, limit)));
}

async function fetchHyperliquidMarketCandles({
  market,
  interval,
  now,
  fetchImpl,
  limit,
}: {
  market: string;
  interval: AgentMarketCandleInterval;
  now: number;
  fetchImpl: typeof fetch;
  limit: number;
}): Promise<AgentMarketCandle[]> {
  const coin = hyperliquidCoinFromMarket(market);
  const intervalMs = CANDLE_INTERVAL_MS[interval];
  const endTime = alignTime(now, intervalMs);
  const startTime = endTime - intervalMs * limit;
  const payload = await fetchHyperliquidCandleSnapshot({
    coin,
    interval,
    startTime,
    endTime,
    fetchImpl,
  });
  if (!Array.isArray(payload)) {
    throw new Error("Hyperliquid returned malformed candle data.");
  }
  const candles = payload
    .map((item) =>
      normalizeHyperliquidCandle({
        provider: "hyperliquid",
        source: "live",
        market: `${coin}-PERP`,
        interval,
        value: item,
      }),
    )
    .filter((item): item is AgentMarketCandle => item != null)
    .sort((a, b) => a.openTime - b.openTime)
    .slice(-limit);
  if (candles.length === 0) {
    throw new Error(`Hyperliquid candle data is not available for ${market}.`);
  }
  return candles;
}

async function fetchHyperliquidMetaAndAssetContexts(
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const response = await fetchImpl(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ type: "metaAndAssetCtxs" }),
    cache: "no-store",
    signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid market data returned HTTP ${response.status}.`);
  }
  return response.json();
}

async function fetchHyperliquidCandleSnapshot({
  coin,
  interval,
  startTime,
  endTime,
  fetchImpl,
}: {
  coin: string;
  interval: AgentMarketCandleInterval;
  startTime: number;
  endTime: number;
  fetchImpl: typeof fetch;
}): Promise<unknown> {
  const response = await fetchImpl(HYPERLIQUID_INFO_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "candleSnapshot",
      req: { coin, interval, startTime, endTime },
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Hyperliquid candle data returned HTTP ${response.status}.`);
  }
  return response.json();
}

function parseHyperliquidMetaAndAssetContexts(input: unknown): {
  universe: Array<{ name: string; isDelisted: boolean }>;
  contexts: Array<{
    markPx?: unknown;
    funding?: unknown;
    openInterest?: unknown;
    dayNtlVlm?: unknown;
  }>;
} {
  if (!Array.isArray(input) || input.length < 2) {
    throw new Error("Hyperliquid returned malformed market metadata.");
  }
  const meta = input[0];
  const contexts = input[1];
  if (!meta || typeof meta !== "object" || !Array.isArray(contexts)) {
    throw new Error("Hyperliquid returned malformed market metadata.");
  }
  const universe = (meta as Record<string, unknown>).universe;
  if (!Array.isArray(universe)) {
    throw new Error("Hyperliquid returned malformed market metadata.");
  }
  const normalizedUniverse = universe
    .map((asset) =>
      normalizeHyperliquidUniverseAsset(asset),
    )
    .filter(
      (asset): asset is { name: string; isDelisted: boolean } =>
        asset != null && asset.name.length > 0,
    );
  if (normalizedUniverse.length !== universe.length) {
    throw new Error("Hyperliquid returned malformed market metadata.");
  }
  return {
    universe: normalizedUniverse,
    contexts: contexts as Array<{
      markPx?: unknown;
      funding?: unknown;
      openInterest?: unknown;
      dayNtlVlm?: unknown;
    }>,
  };
}

function normalizeHyperliquidUniverseAsset(
  value: unknown,
): { name: string; isDelisted: boolean } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string") return null;
  return {
    name: record.name.trim().toUpperCase(),
    isDelisted: record.isDelisted === true,
  };
}

function normalizeHyperliquidCandle({
  provider,
  source,
  market,
  interval,
  value,
}: {
  provider: AgentMarketDataProviderId;
  source: AgentMarketCandle["source"];
  market: string;
  interval: AgentMarketCandleInterval;
  value: unknown;
}): AgentMarketCandle | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const openTime = numberValue(record.t);
  const closeTime = numberValue(record.T);
  const openPriceUsd = positiveDecimal(record.o);
  const highPriceUsd = positiveDecimal(record.h);
  const lowPriceUsd = positiveDecimal(record.l);
  const closePriceUsd = positiveDecimal(record.c);
  const volumeBase = positiveDecimal(record.v);
  if (
    !Number.isFinite(openTime) ||
    !Number.isFinite(closeTime) ||
    !openPriceUsd ||
    !highPriceUsd ||
    !lowPriceUsd ||
    !closePriceUsd
  ) {
    return null;
  }
  return {
    provider,
    source,
    market,
    interval,
    openTime,
    closeTime,
    openPriceUsd,
    highPriceUsd,
    lowPriceUsd,
    closePriceUsd,
    volumeBase,
    volumeUsd:
      volumeBase == null
        ? null
        : formatDecimal(Number(volumeBase) * Number(closePriceUsd)),
  };
}

function mockMarketCandles({
  provider,
  market,
  interval,
  now,
  limit,
}: {
  provider: AgentMarketDataProviderId;
  market: string;
  interval: AgentMarketCandleInterval;
  now: number;
  limit: number;
}): AgentMarketCandle[] {
  const values = MOCK_MARKETS[market];
  if (!values) {
    throw new Error(`Mock candle data is not available for ${market}.`);
  }
  const intervalMs = CANDLE_INTERVAL_MS[interval];
  const endTime = alignTime(now, intervalMs);
  const basePrice = Number(values.markPriceUsd);
  const dailyVolume = Number(values.volume24hUsd ?? 0);
  return Array.from({ length: limit }, (_, index) => {
    const openTime = endTime - intervalMs * (limit - index);
    const closeTime = openTime + intervalMs - 1;
    const drift = (index - limit + 1) * 0.0015;
    const open = basePrice * (1 + drift);
    const close = basePrice * (1 + drift + 0.0008);
    const high = Math.max(open, close) * 1.0012;
    const low = Math.min(open, close) * 0.9988;
    const volumeUsd =
      dailyVolume > 0
        ? dailyVolume * (intervalMs / CANDLE_INTERVAL_MS["1d"])
        : null;
    return {
      provider,
      source: "mock" as const,
      market,
      interval,
      openTime,
      closeTime,
      openPriceUsd: formatDecimal(open),
      highPriceUsd: formatDecimal(high),
      lowPriceUsd: formatDecimal(low),
      closePriceUsd: formatDecimal(close),
      volumeBase:
        volumeUsd == null ? null : formatDecimal(volumeUsd / close),
      volumeUsd: volumeUsd == null ? null : formatDecimal(volumeUsd),
    };
  });
}

function hyperliquidCoinFromMarket(market: string): string {
  return market.endsWith("-PERP") ? market.slice(0, -5) : market;
}

function alignTime(value: number, intervalMs: number): number {
  return Math.floor(value / intervalMs) * intervalMs;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function positiveDecimal(value: unknown): string | null {
  const parsed = decimal(value);
  return parsed != null && Number(parsed) > 0 ? parsed : null;
}

function decimal(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  return raw && Number.isFinite(Number(raw)) ? raw : null;
}

function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return value.toFixed(8).replace(/\.?0+$/, "");
}

async function fetchConfiguredIntelligenceItems({
  market,
  provider,
  now,
  fetchImpl,
}: {
  market: string;
  provider: AgentMarketDataProviderId;
  now: number;
  fetchImpl: typeof fetch;
}): Promise<AgentMarketIntelligenceItem[]> {
  const configured = (
    await Promise.all([
      fetchConfiguredFeed({
        url: process.env.CLEARSIG_AGENT_NEWS_JSON_URL,
        market,
        kind: "news",
        source: "configured-news",
        now,
        fetchImpl,
      }),
      fetchConfiguredFeed({
        url: process.env.CLEARSIG_AGENT_MACRO_JSON_URL,
        market,
        kind: "macro",
        source: "configured-macro",
        now,
        fetchImpl,
      }),
    ])
  ).flat();

  if (configured.length > 0) return configured;
  if (provider !== "mock") return coverageGapIntelligenceItems(market, now);
  return mockIntelligenceItems(market, now);
}

async function fetchConfiguredFeed({
  url,
  market,
  kind,
  source,
  now,
  fetchImpl,
}: {
  url?: string;
  market: string;
  kind: "news" | "macro";
  source: string;
  now: number;
  fetchImpl: typeof fetch;
}): Promise<AgentMarketIntelligenceItem[]> {
  const trimmed = url?.trim();
  if (!trimmed) return [];
  const response = await fetchImpl(trimmed, {
    method: "GET",
    headers: { accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`${kind} intelligence returned HTTP ${response.status}.`);
  }
  return normalizeAgentMarketIntelligenceItems(await response.json(), {
    market,
    kind,
    source,
    now,
  });
}

function mockIntelligenceItems(market: string, now: number): AgentMarketIntelligenceItem[] {
  const asset = market.replace("-PERP", "");
  return [
    {
      id: `mock-news:${market}`,
      kind: "news",
      label: `${asset} beta news pulse`,
      summary:
        "No live news provider is configured; this deterministic item marks the news slot for local beta testing.",
      source: "mock",
      impact: "neutral",
      observedAt: now,
    },
    {
      id: `mock-macro:${market}`,
      kind: "macro",
      label: "Macro beta context",
      summary:
        "No live macro provider is configured; this deterministic item keeps agent explanations structured in demos.",
      source: "mock",
      impact: "neutral",
      observedAt: now,
    },
  ];
}

function coverageGapIntelligenceItems(
  market: string,
  now: number,
): AgentMarketIntelligenceItem[] {
  const asset = market.replace("-PERP", "");
  return [
    {
      id: `coverage-gap-news:${market}`,
      kind: "news",
      label: `${asset} news feed not connected`,
      summary:
        "ClearSig has live price, funding, open-interest, and volume data, but no external news feed is configured for this workspace yet.",
      source: "coverage-gap",
      impact: "neutral",
      observedAt: now,
    },
    {
      id: `coverage-gap-macro:${market}`,
      kind: "macro",
      label: "Macro feed not connected",
      summary:
        "ClearSig has not connected a macro/geopolitical feed for this workspace yet, so the scout must avoid claiming macro confirmation.",
      source: "coverage-gap",
      impact: "neutral",
      observedAt: now,
    },
  ];
}

export function isAgentMarketDataProviderId(
  value: string,
): value is AgentMarketDataProviderId {
  return value === "mock" || value === "hyperliquid";
}
