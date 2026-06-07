import type { AgentExecutionRecord } from "@/lib/agents/types";

export type AgentMarketDataProviderId = "mock" | "hyperliquid";

export interface AgentMarketDataSnapshot {
  provider: AgentMarketDataProviderId;
  source: "mock" | "live";
  market: string;
  observedAt: number;
  markPriceUsd: string;
  fundingRatePct: string | null;
  openInterestUsd: string | null;
  volume24hUsd: string | null;
}

export interface AgentMarketDataValidation {
  snapshot: AgentMarketDataSnapshot | null;
  errors: string[];
}

export interface AgentOpenTradePerformance {
  markPriceUsd: string;
  unrealizedPnlUsd: string;
  movePct: number;
}

export function normalizeAgentMarket(
  value: unknown,
): string | null {
  if (typeof value !== "string") return null;
  const market = value.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9._/-]{1,30}$/.test(market) ? market : null;
}

export function normalizeAgentMarketDataSnapshot(
  input: unknown,
): AgentMarketDataValidation {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { snapshot: null, errors: ["Market data snapshot must be an object."] };
  }

  const record = input as Record<string, unknown>;
  const errors: string[] = [];
  const provider = providerValue(record.provider);
  const source = sourceValue(record.source);
  const market = normalizeAgentMarket(record.market);
  const observedAt = numberValue(record.observedAt);
  const markPriceUsd = decimalString(record.markPriceUsd);
  const fundingRatePct = nullableDecimalString(record.fundingRatePct);
  const openInterestUsd = nullablePositiveDecimalString(record.openInterestUsd);
  const volume24hUsd = nullablePositiveDecimalString(record.volume24hUsd);

  if (!provider) errors.push("Market data provider is unsupported.");
  if (!source) errors.push("Market data source must be mock or live.");
  if (!market) errors.push("Market is missing or invalid.");
  if (!Number.isFinite(observedAt) || observedAt <= 0) {
    errors.push("Observed timestamp is missing or invalid.");
  }
  if (!markPriceUsd || Number(markPriceUsd) <= 0) {
    errors.push("Mark price must be greater than zero.");
  }
  if (record.fundingRatePct != null && fundingRatePct == null) {
    errors.push("Funding rate must be a decimal or null.");
  }
  if (record.openInterestUsd != null && openInterestUsd == null) {
    errors.push("Open interest must be greater than zero or null.");
  }
  if (record.volume24hUsd != null && volume24hUsd == null) {
    errors.push("24h volume must be greater than zero or null.");
  }

  if (
    errors.length > 0 ||
    !provider ||
    !source ||
    !market ||
    !markPriceUsd
  ) {
    return { snapshot: null, errors };
  }

  return {
    snapshot: {
      provider,
      source,
      market,
      observedAt,
      markPriceUsd,
      fundingRatePct,
      openInterestUsd,
      volume24hUsd,
    },
    errors: [],
  };
}

export function agentMarketDataFreshnessError(
  snapshot: AgentMarketDataSnapshot,
  {
    now = Date.now(),
    maxAgeMs = 60_000,
    maxFutureSkewMs = 10_000,
  }: {
    now?: number;
    maxAgeMs?: number;
    maxFutureSkewMs?: number;
  } = {},
): string | null {
  if (snapshot.observedAt < now - maxAgeMs) {
    return "Market data snapshot is stale.";
  }
  if (snapshot.observedAt > now + maxFutureSkewMs) {
    return "Market data snapshot timestamp is too far in the future.";
  }
  return null;
}

export function estimateAgentOpenTradePerformance(
  execution: AgentExecutionRecord,
  snapshot: AgentMarketDataSnapshot | null,
): AgentOpenTradePerformance | null {
  if (
    execution.status !== "open" ||
    !snapshot ||
    snapshot.market.trim().toUpperCase() !== execution.market.trim().toUpperCase()
  ) {
    return null;
  }
  const entry = Number(execution.entryPrice ?? 0);
  const mark = Number(snapshot.markPriceUsd);
  const notional = Number(execution.notionalUsd);
  if (
    !Number.isFinite(entry) ||
    entry <= 0 ||
    !Number.isFinite(mark) ||
    mark <= 0 ||
    !Number.isFinite(notional)
  ) {
    return null;
  }
  const direction = execution.side === "long" ? 1 : -1;
  const movePct = ((mark - entry) / entry) * 100 * direction;
  return {
    markPriceUsd: snapshot.markPriceUsd,
    unrealizedPnlUsd: String(roundMoney((notional * movePct) / 100)),
    movePct,
  };
}

function providerValue(value: unknown): AgentMarketDataProviderId | null {
  return value === "mock" || value === "hyperliquid" ? value : null;
}

function sourceValue(value: unknown): AgentMarketDataSnapshot["source"] | null {
  return value === "mock" || value === "live" ? value : null;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function decimalString(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const raw = String(value).trim();
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? raw : null;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function nullableDecimalString(value: unknown): string | null {
  if (value == null) return null;
  return decimalString(value);
}

function nullablePositiveDecimalString(value: unknown): string | null {
  const parsed = nullableDecimalString(value);
  return parsed != null && Number(parsed) > 0 ? parsed : null;
}
