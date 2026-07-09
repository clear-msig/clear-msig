import { describe, expect, it } from "vitest";
import { assertPolicyNotDenied, type PolicyEnforcementPlan } from "@/lib/policies/enforce";
import { encodeTypedSolPolicy } from "@/lib/policies/onchain";

function plan(action: "allow" | "deny"): PolicyEnforcementPlan {
  return {
    evaluation: {
      ruleId: "rule-1",
      ruleName: "Block unknown recipients",
      matched: true,
      reasons: [],
      action,
    },
    rule: {
      id: "rule-1",
      walletName: "Team treasury#abc123",
      name: "Block unknown recipients",
      priority: 10,
      enabled: true,
      conditions: [],
      action,
      createdAt: 1,
      updatedAt: 1,
      version: 1,
    },
    extraApprovers: [],
    extraCooldownSeconds: 0,
    conditions: [],
  };
}

describe("policy enforcement guardrails", () => {
  it("throws before signing when a matching policy denies the action", () => {
    expect(() => assertPolicyNotDenied(plan("deny"))).toThrow(
      'Policy "Block unknown recipients" denies this send.',
    );
  });

  it("allows non-deny policy outcomes to continue", () => {
    expect(() => assertPolicyNotDenied(plan("allow"))).not.toThrow();
    expect(() =>
      assertPolicyNotDenied({
        evaluation: null,
        rule: null,
        conditions: [],
        extraApprovers: [],
        extraCooldownSeconds: 0,
      }),
    ).not.toThrow();
  });

  it("encodes SOL velocity caps into the committed on-chain policy bytes", () => {
    const encoded = encodeTypedSolPolicy({
      evaluation: {
        ruleId: "rule-velocity",
        ruleName: "Daily spend cap",
        matched: true,
        reasons: [],
        action: "allow",
      },
      rule: {
        id: "rule-velocity",
        walletName: "Team treasury#abc123",
        name: "Daily spend cap",
        priority: 10,
        enabled: true,
        conditions: [],
        action: "allow",
        createdAt: 1,
        updatedAt: 1,
        version: 1,
      },
      extraApprovers: [],
      extraCooldownSeconds: 0,
      conditions: [
        {
          kind: "velocity",
          ticker: "SOL",
          capDisplay: "1.25",
          windowDays: 1,
        },
      ],
    });

    expect(encoded).not.toBeNull();
    expect(Array.from(encoded!.bytes.slice(0, 19))).toEqual([
      0x43, 0x53, 0x50, 0x31, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    expect(encoded!.bytes[19]).toBe(1);
    expect(encoded!.bytes[20]).toBe(12);
    expect(encoded!.bytes[21]).toBe(0);
    expect(readU64Le(encoded!.bytes, 22)).toBe(1_250_000_000n);
    expect(readU32Le(encoded!.bytes, 30)).toBe(86_400);
  });
});

function readU32Le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] |
    (bytes[offset + 1] << 8) |
    (bytes[offset + 2] << 16) |
    (bytes[offset + 3] << 24)
  ) >>> 0;
}

function readU64Le(bytes: Uint8Array, offset: number): bigint {
  let out = 0n;
  for (let i = 0; i < 8; i++) {
    out |= BigInt(bytes[offset + i]) << BigInt(i * 8);
  }
  return out;
}
