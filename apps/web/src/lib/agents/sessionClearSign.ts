import {
  type AgentSessionGrantPayload,
  type ClearSignIntentInput,
} from "@/lib/clearsign";
import type { AgentSessionGrant } from "@/lib/agents/types";
import {
  decimalToAgentUsdRaw,
  hashAgentText,
  normalizeAgentHash,
} from "@/lib/agents/agentClearSignEncoding";

export function buildAgentSessionClearSign(
  session: AgentSessionGrant,
  input: {
    walletId: string;
    venue: string;
    market: string;
    status: "active" | "revoked";
  },
) {
  const expiresAt = Math.floor(session.expiresAt / 1000);
  const payload: AgentSessionGrantPayload = {
    sessionId: session.id,
    agentId: session.agentId,
    venue: input.venue.trim(),
    market: input.market.trim().toUpperCase(),
    maxNotionalUsd: normalizeDecimal(session.maxNotionalUsd ?? "0"),
    maxLeverage: `${Math.max(0, session.maxLeverage ?? 0)}x`,
    expiresAt,
    status: input.status,
  };
  const envelope: ClearSignIntentInput<AgentSessionGrantPayload> = {
    kind: "agent_session_grant",
    network: "Hyperliquid testnet",
    walletName: session.walletName,
    walletId: input.walletId,
    actionId: `${input.status}:${session.id}`,
    nonce: `${session.id}:${session.updatedAt}`,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
    policyCommitment: normalizeAgentHash(session.policyHash),
    payload,
  };
  return {
    envelope,
    executor: {
      sessionIdHash: hashAgentText(payload.sessionId),
      agentIdHash: hashAgentText(payload.agentId),
      venueHash: hashAgentText(payload.venue),
      marketHash: hashAgentText(payload.market),
      maxNotionalRaw: decimalToAgentUsdRaw(payload.maxNotionalUsd),
      maxLeverageX100: Math.round((session.maxLeverage ?? 0) * 100),
      expiresAt,
      status: input.status === "active" ? (1 as const) : (2 as const),
    },
  };
}

function normalizeDecimal(value: string): string {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? String(parsed) : value.trim();
}
