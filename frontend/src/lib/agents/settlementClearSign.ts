import {
  summarizeClearSignAction,
  type AgentTradeSettlementPayload,
  type ClearSignEnvelope,
  type ClearSignDeviceProfileRequest,
} from "@/lib/clearsign";
import { decimalToAgentUsdRaw, hashAgentText, normalizeAgentHash } from "@/lib/agents/agentClearSignEncoding";
import type { AgentRiskLedgerAccount } from "@/lib/agents/agentRiskLedger";
import type { HyperliquidTestnetSettlementArtifact } from "@/lib/agents/serverHyperliquidTestnet";

export interface TrustedAgentSettlementInput {
  requestId: string;
  proposalId: string;
  settlementArtifactHash: string;
  closedNotionalUsd: string;
  realizedPnlUsd: string;
  artifact: HyperliquidTestnetSettlementArtifact;
}

export function buildAgentSettlementClearSign({
  walletName,
  walletId,
  sessionId,
  policyHash,
  ledger,
  settlement,
  deviceProfile,
}: {
  walletName: string;
  walletId: string;
  sessionId: string;
  policyHash: string;
  ledger: AgentRiskLedgerAccount;
  settlement: TrustedAgentSettlementInput;
  deviceProfile?: ClearSignDeviceProfileRequest;
}) {
  if (!/^[0-9a-f]{64}$/i.test(policyHash) || !/^[0-9a-f]{64}$/i.test(settlement.settlementArtifactHash)) {
    throw new Error("Settlement policy or artifact commitment is invalid.");
  }
  const pnl = signedDecimal(settlement.realizedPnlUsd);
  const outcome: AgentTradeSettlementPayload["outcome"] = pnl.sign > 0 ? "profit" : pnl.sign < 0 ? "loss" : "flat";
  const payload: AgentTradeSettlementPayload = {
    sessionId,
    executionId: settlement.requestId,
    settlementArtifactHash: normalizeAgentHash(settlement.settlementArtifactHash),
    oraclePolicyHash: ledger.oraclePolicyHash,
    closedNotionalRaw: decimalToAgentUsdRaw(settlement.closedNotionalUsd),
    outcome,
    pnlAbsRaw: outcome === "flat" ? "0" : decimalToAgentUsdRaw(pnl.magnitude),
    settlementSequence: Number(ledger.nextSettlementSequence),
  };
  if (!Number.isSafeInteger(payload.settlementSequence)) {
    throw new Error("Agent settlement sequence exceeds browser-safe integer range.");
  }
  if (BigInt(payload.closedNotionalRaw) > ledger.openNotionalRaw) {
    throw new Error("Trusted settlement exceeds the session's open on-chain exposure.");
  }
  const envelope: ClearSignEnvelope<AgentTradeSettlementPayload> = {
    version: 3,
    kind: "agent_trade_settlement",
    network: "Hyperliquid testnet",
    walletName,
    walletId,
    actionId: `settlement:${settlement.requestId}:${payload.settlementSequence}`,
    nonce: `${settlement.settlementArtifactHash}:${payload.settlementSequence}`,
    expiresAt: Math.floor(settlement.artifact.settledAt / 1000) + 7 * 24 * 60 * 60,
    policyCommitment: normalizeAgentHash(policyHash),
    payload,
  };
  return {
    envelope,
    summary: summarizeClearSignAction(envelope, deviceProfile),
    executor: {
      sessionIdHash: hashAgentText(sessionId),
      executionIdHash: hashAgentText(settlement.requestId),
      settlementArtifactHash: payload.settlementArtifactHash,
      oraclePolicyHash: payload.oraclePolicyHash,
      closedNotionalRaw: payload.closedNotionalRaw,
      outcome: outcome === "profit" ? (1 as const) : outcome === "loss" ? (2 as const) : (3 as const),
      pnlAbsRaw: payload.pnlAbsRaw,
      settlementSequence: payload.settlementSequence,
    },
  };
}

function signedDecimal(value: string): { sign: -1 | 0 | 1; magnitude: string } {
  const normalized = value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) throw new Error("Trusted settlement P/L is invalid.");
  const magnitude = `${match[2]}${match[3] ? `.${match[3]}` : ""}`;
  const nonzero = /[1-9]/.test(`${match[2]}${match[3] ?? ""}`);
  return {
    sign: nonzero ? (match[1] ? -1 : 1) : 0,
    magnitude,
  };
}
