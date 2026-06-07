import {
  normalizeAgentMarket,
  type AgentMarketDataProviderId,
  type AgentMarketDataSnapshot,
} from "@/lib/agents/marketData";

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

async function fetchHyperliquidMarketData({
  market,
  now,
  fetchImpl,
}: {
  market: string;
  now: number;
  fetchImpl: typeof fetch;
}): Promise<AgentMarketDataSnapshot> {
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

  const payload: unknown = await response.json();
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

function parseHyperliquidMetaAndAssetContexts(input: unknown): {
  universe: Array<{ name: string }>;
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
      asset &&
      typeof asset === "object" &&
      typeof (asset as Record<string, unknown>).name === "string"
        ? { name: String((asset as Record<string, unknown>).name).trim().toUpperCase() }
        : null,
    )
    .filter((asset): asset is { name: string } => asset != null && asset.name.length > 0);
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

function hyperliquidCoinFromMarket(market: string): string {
  return market.endsWith("-PERP") ? market.slice(0, -5) : market;
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

export function isAgentMarketDataProviderId(
  value: string,
): value is AgentMarketDataProviderId {
  return value === "mock" || value === "hyperliquid";
}
