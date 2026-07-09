"use client";

// Shared policy enforcement helper for send flows.
//
// The send pages already use the policy evaluator for deny banners.
// This module extends that into the actual submit path:
//   - require-extra-approvers => collect and submit the extra approvals
//   - require-cooldown         => wait the extra cooldown before execute
//
// Rule authoring stays browser-local for now, while the resulting typed
// policy is committed by the signers and enforced by the program.

import type { CandidateProposal } from "@/lib/policies/evaluate";
import { evaluateFirstMatch } from "@/lib/policies/evaluate";
import { listPolicies } from "@/lib/policies/storage";
import type { PolicyRule, RuleCondition, RuleEvaluation } from "@/lib/policies/types";
import { decryptPolicy } from "@/lib/encrypt/client";
import {
  decryptConditions,
  decryptCooldownSeconds,
} from "@/lib/policies/encryption";
import {
  BUDGET_WINDOW_MS,
  VELOCITY_WINDOW_MS,
  getBudget,
  type PolicyChainTicker,
} from "@/lib/retail/spendingBudget";

const decoder = new TextDecoder();

export interface PolicyEnforcementPlan {
  evaluation: RuleEvaluation | null;
  rule: PolicyRule | null;
  conditions: RuleCondition[];
  extraApprovers: string[];
  extraCooldownSeconds: number;
  onchainLimits: {
    velocityCapDisplay: string | null;
    velocityWindowSeconds: number;
    maxSendCount: number;
    countWindowSeconds: number;
  };
}

export function assertPolicyNotDenied(
  plan: PolicyEnforcementPlan,
  actionLabel: string = "send",
): void {
  if (plan.evaluation?.matched && plan.evaluation.action === "deny") {
    const name = plan.rule?.name ?? plan.evaluation.ruleName;
    throw new Error(`Policy "${name}" denies this ${actionLabel}.`);
  }
}

export async function resolvePolicyEnforcement(
  walletName: string,
  candidate: CandidateProposal,
): Promise<PolicyEnforcementPlan> {
  const onchainLimits = resolveOnchainLimits(walletName, candidate.ticker);
  const rules = listPolicies(walletName);
  const evaluation = await evaluateFirstMatch(rules, candidate);
  if (!evaluation) {
    return {
      evaluation: null,
      rule: null,
      conditions: [],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      onchainLimits,
    };
  }

  const rule = rules.find((r) => r.id === evaluation.ruleId) ?? null;
  if (!rule) {
    return {
      evaluation,
      rule: null,
      conditions: [],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      onchainLimits,
    };
  }

  let extraApprovers: string[] = [];
  const conditions = await decryptConditions(rule.conditions);
  if (rule.action === "require-extra-approvers") {
    extraApprovers = await decryptRuleStrings(rule.extraApproversEncrypted ?? []);
  }

  return {
    evaluation,
    rule,
    conditions,
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
    onchainLimits,
  };
}

function resolveOnchainLimits(
  walletName: string,
  tickerInput: string,
): PolicyEnforcementPlan["onchainLimits"] {
  const budget = getBudget(walletName);
  const ticker = tickerInput.trim().toUpperCase() as PolicyChainTicker;
  const nativeCap = budget?.onchainWeeklyNative?.[ticker] ?? null;
  return {
    velocityCapDisplay:
      typeof nativeCap === "string" && nativeCap.trim().length > 0
        ? nativeCap
        : null,
    velocityWindowSeconds: Math.floor(BUDGET_WINDOW_MS / 1000),
    maxSendCount: Math.max(0, Math.floor(budget?.velocityPerDay ?? 0)),
    countWindowSeconds: Math.floor(VELOCITY_WINDOW_MS / 1000),
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
