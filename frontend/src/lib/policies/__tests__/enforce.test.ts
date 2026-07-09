import { describe, expect, it } from "vitest";
import { assertPolicyNotDenied, type PolicyEnforcementPlan } from "@/lib/policies/enforce";

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
        extraApprovers: [],
        extraCooldownSeconds: 0,
      }),
    ).not.toThrow();
  });
});
