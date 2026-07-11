import {
  summarizeClearSignAction,
  type AgentSessionGrantPayload,
  type ClearSignEnvelope,
} from "@/lib/clearsign-v2";
import type { AgentSessionGrant } from "@/lib/agents/types";
import { sha256, toHex } from "@/lib/msig/hash";

const encoder = new TextEncoder();
const ZERO_HASH = "0".repeat(64);

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
  const envelope: ClearSignEnvelope<AgentSessionGrantPayload> = {
    version: 2,
    kind: "agent_session_grant",
    walletName: session.walletName,
    walletId: input.walletId,
    actionId: `${input.status}:${session.id}`,
    nonce: `${session.id}:${session.updatedAt}`,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
    policyCommitment: normalizeHash(session.policyHash),
    payload,
  };
  const summary = summarizeClearSignAction(envelope);
  return {
    envelope,
    summary,
    executor: {
      sessionIdHash: hashText(payload.sessionId),
      agentIdHash: hashText(payload.agentId),
      venueHash: hashText(payload.venue),
      marketHash: hashText(payload.market),
      maxNotionalRaw: decimalToUsdRaw(payload.maxNotionalUsd),
      maxLeverageX100: Math.round((session.maxLeverage ?? 0) * 100),
      expiresAt,
      status: input.status === "active" ? (1 as const) : (2 as const),
    },
  };
}

function hashText(value: string): string {
  return toHex(sha256(encoder.encode(value.trim())));
}

function normalizeHash(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : ZERO_HASH;
}

function normalizeDecimal(value: string): string {
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? String(parsed) : value.trim();
}

function decimalToUsdRaw(value: string): string {
  if (!/^\d+(\.\d+)?$/.test(value)) return "0";
  const [whole, fraction = ""] = value.split(".");
  return (
    BigInt(whole || "0") * 1_000_000n +
    BigInt(fraction.padEnd(6, "0").slice(0, 6) || "0")
  ).toString();
}
