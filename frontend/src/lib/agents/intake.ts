import {
  newAgentProposalId,
} from "@/lib/agents/storage";
import type {
  AgentProfile,
  AgentTradeProposal,
  TradeOrderType,
  TradeSide,
  TradingVenue,
} from "@/lib/agents/types";

export interface AgentSignalPayload {
  clientSignalId?: string;
  submittedAt?: number;
  venue: TradingVenue;
  market: string;
  side: TradeSide;
  orderType?: TradeOrderType;
  notionalUsd: string;
  leverage: number;
  entryPrice?: string | null;
  stopLossPrice?: string | null;
  takeProfitPrice?: string | null;
  confidence?: number;
  expiresInMinutes?: number;
  thesis?: string;
  technicalSummary?: string;
  fundamentalSummary?: string;
  newsSummary?: string;
  riskPlan?: string;
  exitPlan?: string;
  invalidation?: string;
}

export interface AgentSignalParseResult {
  payload: AgentSignalPayload | null;
  errors: string[];
}

export interface AgentSignalParseOptions {
  requireClientMetadata?: boolean;
}

export function sampleAgentSignalPayload(): AgentSignalPayload {
  return {
    clientSignalId: `signal-${Date.now()}`,
    submittedAt: Date.now(),
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "65000",
    takeProfitPrice: "69000",
    confidence: 72,
    expiresInMinutes: 15,
    thesis: "Momentum breakout with defined invalidation.",
    technicalSummary: "Price reclaimed support with momentum improving.",
    fundamentalSummary: "No conflicting fundamental catalyst was supplied.",
    newsSummary: "No major adverse news catalyst was supplied.",
    riskPlan: "Small notional, 1x leverage, defined stop and target.",
    exitPlan: "Exit at target, stop, or if the support reclaim fails.",
    invalidation: "Invalid if price trades through the stop loss.",
  };
}

export function parseAgentSignalJson(
  raw: string,
  options: AgentSignalParseOptions = {},
): AgentSignalParseResult {
  try {
    const parsed: unknown = JSON.parse(raw);
    return normalizeAgentSignalPayload(parsed, options);
  } catch {
    return {
      payload: null,
      errors: ["Signal must be valid JSON."],
    };
  }
}

export function normalizeAgentSignalPayload(
  input: unknown,
  options: AgentSignalParseOptions = {},
): AgentSignalParseResult {
  const errors: string[] = [];
  if (!input || typeof input !== "object") {
    return { payload: null, errors: ["Signal must be a JSON object."] };
  }
  const source = input as Record<string, unknown>;
  const venue = stringValue(source.venue) as TradingVenue;
  const market = stringValue(source.market).toUpperCase();
  const side = stringValue(source.side).toLowerCase() as TradeSide;
  const orderType = (stringValue(source.orderType || "market").toLowerCase() ||
    "market") as TradeOrderType;
  const clientSignalId = optionalString(source.clientSignalId) ?? undefined;
  const submittedAt = optionalNumber(source.submittedAt);
  const notionalUsd = stringValue(source.notionalUsd);
  const leverage = numberValue(source.leverage);
  const confidence = clamp(numberValue(source.confidence ?? 70), 0, 100);
  const expiresInMinutes = Math.max(1, numberValue(source.expiresInMinutes ?? 15));

  if (!isTradingVenue(venue)) errors.push("Venue must be a supported trading venue.");
  if (!market) errors.push("Market is required.");
  if (!isTradeSide(side)) errors.push("Side must be long or short.");
  if (!isOrderType(orderType)) errors.push("Order type must be market or limit.");
  if (options.requireClientMetadata && !clientSignalId) {
    errors.push("Client signal ID is required.");
  }
  if (clientSignalId && !isSafeClientSignalId(clientSignalId)) {
    errors.push("Client signal ID must be 80 safe characters or fewer.");
  }
  if (options.requireClientMetadata && submittedAt == null) {
    errors.push("Submitted at is required.");
  }
  if (source.submittedAt != null && submittedAt == null) {
    errors.push("Submitted at must be a Unix millisecond timestamp.");
  }
  if (!positiveNumber(notionalUsd)) errors.push("Notional size must be greater than zero.");
  if (!Number.isFinite(leverage) || leverage <= 0) {
    errors.push("Leverage must be greater than zero.");
  }

  if (errors.length > 0) return { payload: null, errors };

  return {
    payload: {
      clientSignalId,
      submittedAt: submittedAt ?? undefined,
      venue,
      market,
      side,
      orderType,
      notionalUsd,
      leverage,
      entryPrice: optionalString(source.entryPrice),
      stopLossPrice: optionalString(source.stopLossPrice),
      takeProfitPrice: optionalString(source.takeProfitPrice),
      confidence,
      expiresInMinutes,
      thesis: optionalString(source.thesis) ?? undefined,
      technicalSummary: optionalString(source.technicalSummary) ?? undefined,
      fundamentalSummary: optionalString(source.fundamentalSummary) ?? undefined,
      newsSummary: optionalString(source.newsSummary) ?? undefined,
      riskPlan: optionalString(source.riskPlan) ?? undefined,
      exitPlan: optionalString(source.exitPlan) ?? undefined,
      invalidation: optionalString(source.invalidation) ?? undefined,
    },
    errors: [],
  };
}

export function buildAgentTradeProposalFromSignal({
  walletName,
  agent,
  signal,
  now = Date.now(),
}: {
  walletName: string;
  agent: AgentProfile;
  signal: AgentSignalPayload;
  now?: number;
}): AgentTradeProposal {
  const submittedAt = validTimestamp(signal.submittedAt) ? signal.submittedAt : now;
  const expiresAt =
    submittedAt + Math.max(1, signal.expiresInMinutes ?? 15) * 60 * 1000;
  return {
    id: newAgentProposalId(),
    walletName,
    agentId: agent.id,
    venue: signal.venue,
    market: signal.market.trim().toUpperCase(),
    side: signal.side,
    orderType: signal.orderType ?? "market",
    notionalUsd: signal.notionalUsd.trim(),
    leverage: signal.leverage,
    entryPrice: signal.entryPrice ?? null,
    stopLossPrice: signal.stopLossPrice ?? null,
    takeProfitPrice: signal.takeProfitPrice ?? null,
    thesis: signal.thesis?.trim() || undefined,
    confidence: clamp(signal.confidence ?? 70, 0, 100),
    clientSignalId: signal.clientSignalId,
    expiresAt,
    status: "draft",
    createdAt: submittedAt,
    updatedAt: now,
    version: 1,
  };
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: unknown): string | null {
  const trimmed = stringValue(value);
  return trimmed ? trimmed : null;
}

function numberValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
}

function optionalNumber(value: unknown): number | null {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveNumber(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

function validTimestamp(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function isTradingVenue(value: string): value is TradingVenue {
  return value === "mock_perps" || value === "hyperliquid_testnet" || value === "bulktrade_mock";
}

function isTradeSide(value: string): value is TradeSide {
  return value === "long" || value === "short";
}

function isOrderType(value: string): value is TradeOrderType {
  return value === "market" || value === "limit";
}

function isSafeClientSignalId(value: string): boolean {
  return /^[A-Za-z0-9._:-]{1,80}$/.test(value);
}
