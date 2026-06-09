import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentSolanaDelegationSummary,
  getAgentSolanaDelegation,
  saveAgentSolanaDelegation,
  updateAgentSolanaDelegationStatus,
} from "@/lib/agents/solanaDelegation";
import type { AgentVaultPolicy } from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 9, 12, 0, 0);
const signer = "11111111111111111111111111111112";

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  } as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Solana agent delegation", () => {
  it("stores a policy-bound active delegation", () => {
    const record = saveAgentSolanaDelegation({
      walletName: "vault",
      agentId: "agent-alpha",
      agentSignerPubkey: signer,
      policy: policy(),
      now,
    });
    const summary = buildAgentSolanaDelegationSummary({
      delegation: record,
      policy: policy(),
      now,
    });

    expect(getAgentSolanaDelegation("vault", "agent-alpha").agentSignerPubkey).toBe(signer);
    expect(record.status).toBe("active");
    expect(record.policyHash).toBe("policy-current");
    expect(summary.status).toBe("ready");
  });

  it("blocks stale policy hash and expired delegations", () => {
    const record = saveAgentSolanaDelegation({
      walletName: "vault",
      agentId: "agent-alpha",
      agentSignerPubkey: signer,
      policy: policy(),
      expiresAt: now + 60_000,
      now,
    });

    expect(
      buildAgentSolanaDelegationSummary({
        delegation: record,
        policy: { ...policy(), policyHash: "policy-new" },
        now,
      }).steps.find((step) => step.id === "policy")?.status,
    ).toBe("blocked");
    expect(
      buildAgentSolanaDelegationSummary({
        delegation: record,
        policy: policy(),
        now: now + 120_000,
      }).steps.find((step) => step.id === "expiry")?.status,
    ).toBe("blocked");
  });

  it("tracks rotation and revocation lifecycle", () => {
    saveAgentSolanaDelegation({
      walletName: "vault",
      agentId: "agent-alpha",
      agentSignerPubkey: signer,
      policy: policy(),
      now,
    });
    const rotating = updateAgentSolanaDelegationStatus({
      walletName: "vault",
      agentId: "agent-alpha",
      status: "rotation_required",
      reason: "Signer was shared outside the agent runtime.",
      now: now + 1,
    });
    const revoked = updateAgentSolanaDelegationStatus({
      walletName: "vault",
      agentId: "agent-alpha",
      status: "revoked",
      now: now + 2,
    });

    expect(rotating.rotationReason).toBe("Signer was shared outside the agent runtime.");
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAt).toBe(now + 2);
    expect(
      buildAgentSolanaDelegationSummary({
        delegation: revoked,
        policy: policy(),
        now,
      }).status,
    ).toBe("blocked");
  });
});

function policy(): AgentVaultPolicy {
  return {
    id: "policy",
    walletName: "vault",
    policyHash: "policy-current",
    enabled: true,
    emergencyPaused: false,
    allowedVenues: ["mock_perps", "hyperliquid_testnet"],
    allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "500",
    maxLeverage: 2,
    requireStopLoss: true,
    requireTakeProfit: false,
    maxOpenPositionsPerAgent: 1,
    cooldownSeconds: 0,
    maxSessionHours: 24,
    dailyLossCapUsd: "100",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
