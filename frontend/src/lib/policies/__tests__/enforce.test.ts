import { describe, expect, it } from "vitest";
import {
  assertPolicyNotDenied,
  type PolicyEnforcementPlan,
} from "@/lib/policies/enforce";
import {
  encodeTypedRemoteSendPolicy,
  encodeTypedSolPolicy,
} from "@/lib/policies/onchain";
import { sha256, toHex } from "@/lib/msig/hash";

const NO_LIMITS: PolicyEnforcementPlan["onchainLimits"] = {
  velocityCapDisplay: null,
  velocityWindowSeconds: 0,
  maxSendCount: 0,
  countWindowSeconds: 0,
};

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
    onchainLimits: NO_LIMITS,
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
        onchainLimits: NO_LIMITS,
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
      onchainLimits: NO_LIMITS,
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

  it("encodes EVM recipients as sha256 text commitments for remote typed sends", () => {
    const recipient = "0x1111111111111111111111111111111111111111";
    const encoded = encodeTypedRemoteSendPolicy(
      {
        evaluation: {
          ruleId: "rule-eth",
          ruleName: "ETH guard",
          matched: true,
          reasons: [],
          action: "allow",
        },
        rule: {
          id: "rule-eth",
          walletName: "Team treasury#abc123",
          name: "ETH guard",
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
            kind: "recipient",
            mode: "allowlist",
            addresses: [recipient.toUpperCase()],
          },
          {
            kind: "amount",
            ticker: "ETH",
            maxDisplay: "0.5",
          },
        ],
        onchainLimits: NO_LIMITS,
      },
      {
        assetTicker: "ETH",
        decimals: 18,
        normalizeRecipient: (value) => value.trim().toLowerCase(),
      },
    );

    expect(encoded).not.toBeNull();
    expect(encoded!.bytes[4]).toBe(1);
    expect(readU64Le(encoded!.bytes, 5)).toBe(500_000_000_000_000_000n);
    expect(encoded!.bytes[17]).toBe(1);
    expect(toHex(encoded!.bytes.slice(19, 51))).toBe(
      toHex(sha256(new TextEncoder().encode(recipient))),
    );
  });

  it("encodes deny, required-approver, and cooldown actions for remote execution", () => {
    const approver = "11111111111111111111111111111111";
    const deny = encodeTypedRemoteSendPolicy(plan("deny"), {
      assetTicker: "BTC",
      decimals: 8,
    });
    const protectedPlan: PolicyEnforcementPlan = {
      evaluation: null,
      rule: null,
      conditions: [],
      extraApprovers: [approver],
      extraCooldownSeconds: 3_600,
      onchainLimits: NO_LIMITS,
    };
    const protectedPolicy = encodeTypedRemoteSendPolicy(protectedPlan, {
      assetTicker: "ZEC",
      decimals: 8,
    });

    expect(deny).not.toBeNull();
    expect(deny!.bytes[4]).toBe(1);
    expect(deny!.bytes[17]).toBe(0);
    expect(protectedPolicy).not.toBeNull();
    expect(readU32Le(protectedPolicy!.bytes, 13)).toBe(3_600);
    expect(protectedPolicy!.bytes[18]).toBe(1);
    expect(Array.from(protectedPolicy!.bytes.slice(19, 51))).toEqual(
      new Array(32).fill(0),
    );
  });

  it("encodes saved amount and send-count limits without an advanced rule", () => {
    const encoded = encodeTypedSolPolicy({
      evaluation: null,
      rule: null,
      conditions: [],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      onchainLimits: {
        velocityCapDisplay: "2.5",
        velocityWindowSeconds: 7 * 86_400,
        maxSendCount: 3,
        countWindowSeconds: 86_400,
      },
    });

    expect(encoded).not.toBeNull();
    expect(encoded!.bytes[19]).toBe(1);
    expect(readU64Le(encoded!.bytes, 22)).toBe(2_500_000_000n);
    expect(readU32Le(encoded!.bytes, 30)).toBe(7 * 86_400);
    expect(encoded!.bytes[34]).toBe(2);
    expect(readU32Le(encoded!.bytes, 37)).toBe(3);
    expect(readU32Le(encoded!.bytes, 41)).toBe(86_400);
  });

  it("encodes the Personal allowlist without requiring an advanced rule", () => {
    const recipient = "11111111111111111111111111111111";
    const encoded = encodeTypedSolPolicy({
      evaluation: null,
      rule: null,
      conditions: [],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      recipientGuard: { mode: "allowlist", addresses: [recipient] },
      onchainLimits: NO_LIMITS,
    });

    expect(encoded).not.toBeNull();
    expect(encoded!.bytes[4]).toBe(1);
    expect(encoded!.bytes[17]).toBe(1);
    expect(Array.from(encoded!.bytes.slice(19, 51))).toEqual(
      new Array(32).fill(0),
    );
  });

  it("encodes allowed hours and timezone into program-enforced policy bytes", () => {
    const encoded = encodeTypedSolPolicy({
      evaluation: null,
      rule: null,
      conditions: [],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      allowedTimeWindow: {
        startHour: 9,
        endHour: 17,
        daysOfWeek: [1, 2, 3, 4, 5],
        utcOffsetMinutes: -60,
      },
      onchainLimits: NO_LIMITS,
    });

    expect(encoded).not.toBeNull();
    expect(Array.from(encoded!.bytes.slice(19))).toEqual([
      3,
      5,
      0,
      9,
      17,
      0b0011_1110,
      0xc4,
      0xff,
    ]);
  });

  it("encodes per-member allowance caps into isolated program ledger rows", () => {
    const member = "11111111111111111111111111111111";
    const encoded = encodeTypedSolPolicy({
      evaluation: null,
      rule: null,
      conditions: [],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      memberAllowances: [
        { member, capDisplay: "1.25", windowSeconds: 7 * 86_400 },
      ],
      onchainLimits: NO_LIMITS,
    });

    expect(encoded).not.toBeNull();
    expect(encoded!.bytes[19]).toBe(4);
    expect(encoded!.bytes[20]).toBe(44);
    expect(encoded!.bytes[21]).toBe(0);
    expect(readU64Le(encoded!.bytes, 54)).toBe(1_250_000_000n);
    expect(readU32Le(encoded!.bytes, 62)).toBe(7 * 86_400);
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
