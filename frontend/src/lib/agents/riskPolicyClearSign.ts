import {
  summarizeClearSignAction,
  type AgentRiskPolicyPayload,
  type ClearSignEnvelope,
  type ClearSignDeviceProfileRequest,
} from "@/lib/clearsign";
import type { AgentSessionGrant, AgentVaultPolicy } from "@/lib/agents/types";
import {
  decimalToAgentUsdRaw,
  hashAgentText,
  normalizeAgentHash,
} from "@/lib/agents/agentClearSignEncoding";

export const OWNER_ATTESTED_SETTLEMENT_POLICY_HASH = hashAgentText(
  "clearsig:agent-settlement:owner-threshold:v1",
);

export function buildAgentRiskPolicyClearSign(
  session: AgentSessionGrant,
  policy: AgentVaultPolicy,
  walletId: string,
  deviceProfile?: ClearSignDeviceProfileRequest,
) {
  const status = policy.enabled && !policy.emergencyPaused ? "active" : "paused";
  const payload: AgentRiskPolicyPayload = {
    sessionId: session.id,
    oraclePolicyHash: OWNER_ATTESTED_SETTLEMENT_POLICY_HASH,
    maxLossRaw: decimalToAgentUsdRaw(policy.dailyLossCapUsd),
    status,
  };
  const envelope: ClearSignEnvelope<AgentRiskPolicyPayload> = {
    version: 3,
    kind: "agent_risk_policy",
    network: "Hyperliquid testnet",
    walletName: session.walletName,
    walletId,
    actionId: `risk:${status}:${session.id}`,
    nonce: `${session.id}:${policy.updatedAt}`,
    expiresAt: Math.floor(Date.now() / 1000) + 15 * 60,
    policyCommitment: normalizeAgentHash(policy.policyHash),
    payload,
  };
  return {
    envelope,
    summary: summarizeClearSignAction(envelope, deviceProfile),
    executor: {
      sessionIdHash: hashAgentText(session.id),
      oraclePolicyHash: payload.oraclePolicyHash,
      maxLossRaw: payload.maxLossRaw,
      status: status === "active" ? (1 as const) : (2 as const),
    },
  };
}
