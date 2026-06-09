import {
  agentMarketDataFreshnessError,
  type AgentMarketDataSnapshot,
  type AgentMarketDataProviderId,
} from "@/lib/agents/marketData";

export type AgentMarketIntelligenceKind =
  | "market_data"
  | "funding"
  | "liquidity"
  | "news"
  | "macro";

export type AgentMarketIntelligenceImpact = "bullish" | "bearish" | "neutral";

export interface AgentMarketIntelligenceItem {
  id: string;
  kind: AgentMarketIntelligenceKind;
  label: string;
  summary: string;
  source: string;
  impact: AgentMarketIntelligenceImpact;
  observedAt: number;
  url?: string;
}

export interface AgentMarketIntelligenceSnapshot {
  provider: AgentMarketDataProviderId;
  market: string;
  observedAt: number;
  marketData: AgentMarketDataSnapshot;
  items: AgentMarketIntelligenceItem[];
  coverage: {
    marketData: boolean;
    funding: boolean;
    liquidity: boolean;
    news: boolean;
    macro: boolean;
  };
  freshnessWarnings: string[];
  summary: string;
}

export function buildAgentMarketIntelligenceSnapshot({
  marketData,
  items = [],
  now = Date.now(),
}: {
  marketData: AgentMarketDataSnapshot;
  items?: AgentMarketIntelligenceItem[];
  now?: number;
}): AgentMarketIntelligenceSnapshot {
  const normalizedItems = dedupeItems([
    marketDataItem(marketData),
    ...(marketData.fundingRatePct == null ? [] : [fundingItem(marketData)]),
    ...(marketData.openInterestUsd || marketData.volume24hUsd
      ? [liquidityItem(marketData)]
      : []),
    ...items,
  ]);
  const freshness = agentMarketDataFreshnessError(marketData, {
    now,
    maxAgeMs: marketData.source === "live" ? 5 * 60_000 : 24 * 60 * 60_000,
  });
  const news = normalizedItems.filter((item) => item.kind === "news");
  const macro = normalizedItems.filter((item) => item.kind === "macro");
  const connectedNews = news.filter(isConnectedIntelligenceItem);
  const connectedMacro = macro.filter(isConnectedIntelligenceItem);
  return {
    provider: marketData.provider,
    market: marketData.market,
    observedAt: Math.max(marketData.observedAt, ...normalizedItems.map((item) => item.observedAt)),
    marketData,
    items: normalizedItems,
    coverage: {
      marketData: true,
      funding: marketData.fundingRatePct != null,
      liquidity: marketData.openInterestUsd != null || marketData.volume24hUsd != null,
      news: connectedNews.length > 0,
      macro: connectedMacro.length > 0,
    },
    freshnessWarnings: freshness ? [freshness] : [],
    summary: intelligenceSummary({ marketData, news, macro }),
  };
}

export function normalizeAgentMarketIntelligenceItems(
  input: unknown,
  {
    market,
    kind,
    source,
    now = Date.now(),
  }: {
    market: string;
    kind: "news" | "macro";
    source: string;
    now?: number;
  },
): AgentMarketIntelligenceItem[] {
  const rawItems = Array.isArray(input)
    ? input
    : input && typeof input === "object" && Array.isArray((input as Record<string, unknown>).items)
      ? ((input as Record<string, unknown>).items as unknown[])
      : [];
  const normalizedMarket = market.trim().toUpperCase();
  return rawItems
    .map((item, index): AgentMarketIntelligenceItem | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const itemMarket =
        typeof record.market === "string" ? record.market.trim().toUpperCase() : "";
      const assets = Array.isArray(record.assets)
        ? record.assets.map((asset) => String(asset).trim().toUpperCase())
        : [];
      if (
        itemMarket &&
        itemMarket !== normalizedMarket &&
        !assets.includes(normalizedMarket) &&
        !assets.includes(normalizedMarket.replace("-PERP", ""))
      ) {
        return null;
      }
      const label = stringValue(record.label ?? record.title);
      const summary = stringValue(record.summary ?? record.description);
      if (!label || !summary) return null;
      return {
        id: stringValue(record.id) ?? `${kind}:${normalizedMarket}:${index}`,
        kind,
        label,
        summary,
        source: stringValue(record.source) ?? source,
        impact: impactValue(record.impact),
        observedAt: timeValue(record.observedAt ?? record.publishedAt, now),
        url: stringValue(record.url),
      } satisfies AgentMarketIntelligenceItem;
    })
    .filter((item): item is AgentMarketIntelligenceItem => Boolean(item))
    .slice(0, 8);
}

export function summarizeNewsForScout(
  snapshot: AgentMarketIntelligenceSnapshot | null | undefined,
): string | undefined {
  const news = snapshot?.items.filter((item) => item.kind === "news").slice(0, 2) ?? [];
  if (news.length === 0) return undefined;
  return news.map((item) => `${item.label}: ${item.summary}`).join(" ");
}

export function summarizeMacroForScout(
  snapshot: AgentMarketIntelligenceSnapshot | null | undefined,
): string | undefined {
  const macro = snapshot?.items.filter((item) => item.kind === "macro").slice(0, 2) ?? [];
  if (macro.length === 0) return undefined;
  return macro.map((item) => `${item.label}: ${item.summary}`).join(" ");
}

function marketDataItem(snapshot: AgentMarketDataSnapshot): AgentMarketIntelligenceItem {
  return {
    id: `market:${snapshot.market}`,
    kind: "market_data",
    label: `${snapshot.market} mark price`,
    summary: `${snapshot.market} is marked at ${formatUsd(snapshot.markPriceUsd)} from ${snapshot.source} ${snapshot.provider} data.`,
    source: snapshot.provider,
    impact: "neutral",
    observedAt: snapshot.observedAt,
  };
}

function fundingItem(snapshot: AgentMarketDataSnapshot): AgentMarketIntelligenceItem {
  const funding = Number(snapshot.fundingRatePct ?? 0);
  return {
    id: `funding:${snapshot.market}`,
    kind: "funding",
    label: `${snapshot.market} funding`,
    summary: `Funding is ${snapshot.fundingRatePct}%${Math.abs(funding) > 0.03 ? ", elevated enough to matter for directional bias." : "."}`,
    source: snapshot.provider,
    impact: funding > 0.03 ? "bearish" : funding < -0.03 ? "bullish" : "neutral",
    observedAt: snapshot.observedAt,
  };
}

function liquidityItem(snapshot: AgentMarketDataSnapshot): AgentMarketIntelligenceItem {
  return {
    id: `liquidity:${snapshot.market}`,
    kind: "liquidity",
    label: `${snapshot.market} liquidity`,
    summary: `Open interest is ${formatUsd(snapshot.openInterestUsd)} and 24h volume is ${formatUsd(snapshot.volume24hUsd)}.`,
    source: snapshot.provider,
    impact: "neutral",
    observedAt: snapshot.observedAt,
  };
}

function intelligenceSummary({
  marketData,
  news,
  macro,
}: {
  marketData: AgentMarketDataSnapshot;
  news: AgentMarketIntelligenceItem[];
  macro: AgentMarketIntelligenceItem[];
}): string {
  const parts = [
    `${marketData.market} mark ${formatUsd(marketData.markPriceUsd)}`,
    marketData.fundingRatePct == null ? null : `funding ${marketData.fundingRatePct}%`,
    connectedCount(news) > 0
      ? `${connectedCount(news)} news item${connectedCount(news) === 1 ? "" : "s"}`
      : news.length > 0
        ? "news feed not connected"
        : null,
    connectedCount(macro) > 0
      ? `${connectedCount(macro)} macro item${connectedCount(macro) === 1 ? "" : "s"}`
      : macro.length > 0
        ? "macro feed not connected"
        : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function connectedCount(items: AgentMarketIntelligenceItem[]): number {
  return items.filter(isConnectedIntelligenceItem).length;
}

function isConnectedIntelligenceItem(item: AgentMarketIntelligenceItem): boolean {
  return item.source !== "coverage-gap";
}

function dedupeItems(items: AgentMarketIntelligenceItem[]): AgentMarketIntelligenceItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.kind}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function impactValue(value: unknown): AgentMarketIntelligenceImpact {
  return value === "bullish" || value === "bearish" || value === "neutral"
    ? value
    : "neutral";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function timeValue(value: unknown, fallback: number): number {
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed <= 0) return "unavailable";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
}
