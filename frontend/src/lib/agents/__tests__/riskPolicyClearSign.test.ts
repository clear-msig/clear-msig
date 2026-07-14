import { describe, expect, it } from "vitest";
import { buildAgentRiskPolicyClearSign } from "@/lib/agents/riskPolicyClearSign";
import type { AgentSessionGrant, AgentVaultPolicy } from "@/lib/agents/types";

describe("agent risk ClearSign", () => {
  it("binds the session, loss cap, oracle policy, and policy commitment", () => {
    const session = {
      id: "session-1",
      walletName: "team",
      agentId: "agent-1",
      status: "active",
      startsAt: 1,
      expiresAt: 2,
      policyHash: "1".repeat(64),
      createdAt: 1,
      updatedAt: 1,
      version: 1,
    } satisfies AgentSessionGrant;
    const policy = {
      enabled: true,
      emergencyPaused: false,
      dailyLossCapUsd: "12.50",
      policyHash: "1".repeat(64),
      updatedAt: 3,
    } as AgentVaultPolicy;
    const binding = buildAgentRiskPolicyClearSign(
      session,
      policy,
      "11111111111111111111111111111111",
    );
    expect(binding.envelope.kind).toBe("agent_risk_policy");
    expect(binding.envelope.policyCommitment).toBe("1".repeat(64));
    expect(binding.executor.maxLossRaw).toBe("12500000");
    expect(binding.executor.status).toBe(1);
    expect(binding.executor.oraclePolicyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
