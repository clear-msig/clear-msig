"use client";

// Shared policy enforcement helper for send flows.
//
// The send pages already use the policy evaluator for deny banners.
// This module extends that into the actual submit path:
//   - require-extra-approvers => collect and submit the extra approvals
//   - require-cooldown         => wait the extra cooldown before execute
//
// It stays client-side because the current policy system is still
// browser-stored. Once the policy rules move on-chain, this helper
// becomes the UI-side mirror of the program check.

import type { CandidateProposal } from "@/lib/policies/evaluate";
import { evaluateFirstMatch } from "@/lib/policies/evaluate";
import { listPolicies } from "@/lib/policies/storage";
import type { PolicyRule, RuleEvaluation } from "@/lib/policies/types";
import { decryptPolicy } from "@/lib/encrypt/client";
import { decryptCooldownSeconds } from "@/lib/policies/encryption";

const decoder = new TextDecoder();

export interface PolicyEnforcementPlan {
  evaluation: RuleEvaluation | null;
  rule: PolicyRule | null;
  extraApprovers: string[];
  extraCooldownSeconds: number;
}

export async function resolvePolicyEnforcement(
  walletName: string,
  candidate: CandidateProposal,
): Promise<PolicyEnforcementPlan> {
  const rules = listPolicies(walletName);
  const evaluation = await evaluateFirstMatch(rules, candidate);
  if (!evaluation) {
    return {
      evaluation: null,
      rule: null,
      extraApprovers: [],
      extraCooldownSeconds: 0,
    };
  }

  const rule = rules.find((r) => r.id === evaluation.ruleId) ?? null;
  if (!rule) {
    return {
      evaluation,
      rule: null,
      extraApprovers: [],
      extraCooldownSeconds: 0,
    };
  }

  let extraApprovers: string[] = [];
  if (rule.action === "require-extra-approvers") {
    extraApprovers = await decryptRuleStrings(rule.extraApproversEncrypted ?? []);
  }

  return {
    evaluation,
    rule,
    extraApprovers,
    extraCooldownSeconds:
      rule.action === "require-cooldown"
        ? Math.max(
            0,
            (await decryptCooldownSeconds(
              rule.extraCooldownEncrypted,
              rule.extraCooldownSeconds,
            )) ?? 0,
          )
        : 0,
  };
}

async function decryptRuleStrings(
  payloads: NonNullable<PolicyRule["extraApproversEncrypted"]>,
): Promise<string[]> {
  const out: string[] = [];
  for (const payload of payloads) {
    try {
      const bytes = await decryptPolicy(payload);
      const text = decoder.decode(bytes).trim();
      if (text) out.push(text);
    } catch {
      // Skip unreadable entries.
    }
  }
  return out;
}
