import {
  summarizeClearSignAction,
  type AgentTradePayload,
  type ClearSignEnvelope,
} from "@/lib/clearsign";
import { sha256, toHex } from "@/lib/msig/hash";
import type {
  AgentTradeClearSignSnapshot,
  AgentTradeProposal,
} from "@/lib/agents/types";

const enc = new TextEncoder();
const ZERO_HASH = "0".repeat(64);
const USD_DECIMALS = 6;

export function buildAgentTradeClearSign(
  proposal: AgentTradeProposal,
  options: { walletId?: string; sessionId?: string } = {},
): AgentTradeClearSignSnapshot {
  const market = proposal.market.trim().toUpperCase();
  const venue = proposal.venue;
  const assetId = `USDC:${venue}`;
  const sessionId =
    options.sessionId?.trim() ||
    proposal.sessionId?.trim() ||
    proposal.clientSignalId?.trim() ||
    proposal.id;
  const route = `${venue}:${proposal.orderType}`;
  const riskCheckHash = hashStable({
    confidence: proposal.confidence,
    decision: proposal.evaluationDecision ?? null,
    expiresAt: proposal.expiresAt,
    orderType: proposal.orderType,
    policyHash: proposal.policyHash ?? null,
    policyViolations: (proposal.policyViolations ?? []).map((violation) => ({
      code: violation.code,
      message: violation.message,
    })),
    stopLossPrice: proposal.stopLossPrice ?? null,
    takeProfitPrice: proposal.takeProfitPrice ?? null,
  });
  const payload: AgentTradePayload = {
    agentId: proposal.agentId,
    venue,
    market,
    side: proposal.side,
    maxNotionalUsd: normalizeDecimal(proposal.notionalUsd),
    maxLeverage: `${normalizeDecimal(String(proposal.leverage))}x`,
    stopLossRequired: Boolean(proposal.stopLossPrice),
    assetId,
    sessionId,
    route,
    riskCheckHash,
  };
  const envelope: ClearSignEnvelope<AgentTradePayload> = {
    version: 3,
    kind: "agent_trade_approval",
    walletName: proposal.walletName,
    walletId: options.walletId ?? proposal.clearSignV2?.walletId ?? "",
    actionId: proposal.id,
    nonce: sessionId,
    expiresAt: Math.floor(proposal.expiresAt / 1000),
    policyCommitment: normalizePolicyCommitment(proposal.policyHash),
    payload,
  };
  const summary = summarizeClearSignAction(envelope);

  return {
    actionId: envelope.actionId,
    nonce: envelope.nonce,
    expiresAt: envelope.expiresAt,
    walletId: envelope.walletId ?? "",
    policyCommitment: envelope.policyCommitment,
    payloadHash: summary.payloadHash,
    envelopeHash: summary.envelopeHash,
    signableText: summary.signableText,
    onchainProposal: proposal.clearSignV2?.onchainProposal,
    payload: {
      agentId: proposal.agentId,
      venue,
      market,
      side: proposal.side,
      maxNotionalUsd: payload.maxNotionalUsd,
      maxLeverage: payload.maxLeverage,
      stopLossRequired: payload.stopLossRequired,
      assetId,
      sessionId,
      route,
      riskCheckHash,
    },
    executor: {
      amountRaw: decimalToRawAmount(proposal.notionalUsd, USD_DECIMALS),
      agentIdHash: hashText(proposal.agentId),
      venueHash: hashText(venue),
      marketHash: hashText(market),
      sideHash: hashText(proposal.side),
      assetIdHash: hashText(assetId),
      maxLeverageX100: Math.max(0, Math.round(proposal.leverage * 100)),
      sessionIdHash: hashText(sessionId),
      routeHash: hashText(route),
      riskCheckHash,
    },
  };
}

function normalizePolicyCommitment(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ZERO_HASH;
}

function normalizeDecimal(value: string): string {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? String(parsed) : value.trim();
}

function decimalToRawAmount(value: string, decimals: number): string {
  const normalized = normalizeDecimal(value);
  if (!/^\d+(\.\d+)?$/.test(normalized)) return "0";
  const [whole, frac = ""] = normalized.split(".");
  const padded = `${frac.slice(0, decimals)}${"0".repeat(decimals)}`.slice(
    0,
    decimals,
  );
  return (
    BigInt(whole || "0") * 10n ** BigInt(decimals) +
    BigInt(padded || "0")
  ).toString();
}

function hashText(value: string): string {
  return toHex(sha256(enc.encode(value.trim())));
}

function hashStable(value: unknown): string {
  return hashText(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
