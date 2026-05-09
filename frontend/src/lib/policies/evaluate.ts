"use client";

// Client-side rule evaluator. Walks a wallet's policy rules
// against a candidate proposal and returns the first matching
// rule's action, plus per-condition reasoning for the UI.
//
// "First matching" - Fordefi's convention. Rules are sorted by
// priority descending; ties broken by createdAt ascending in
// listPolicies(). The first rule whose every condition matches
// applies.
//
// The evaluator runs at compose-time on the send pages, before
// the user fires the wallet popup. It's a tripwire, not enforced
// by the on-chain program (FHE handlers are the follow-up). A
// determined member with the CLI can bypass it; treat as a UI
// guardrail, not a security boundary.

import { listAttempts } from "@/lib/retail/txLog";
import type {
  AmountCondition,
  AssetCondition,
  PolicyRule,
  RecipientCondition,
  RuleAction,
  RuleCondition,
  RuleEvaluation,
  TimeWindowCondition,
  VelocityCondition,
} from "@/lib/policies/types";
import { decryptConditions } from "@/lib/policies/encryption";

/// What the evaluator checks against. The caller assembles this
/// from the form state on the send page.
export interface CandidateProposal {
  walletName: string;
  /// Chain kind (0 SOL, 1 EVM, 2 BTC, 3 ZEC, 4 ERC-20).
  chainKind: number;
  /// For chain_kind=4, the ERC-20 contract being sent. Lowercase
  /// hex.
  tokenContract?: string | null;
  /// Recipient address as the user has it. Solana base58, EVM 0x.
  recipient: string;
  /// Display ticker - "SOL" / "ETH" / "USDC" / etc.
  ticker: string;
  /// Display amount as the user typed it ("1.5"). Parsed as
  /// JS Number for comparisons; bigint precision isn't needed for
  /// policy-cap checks (they're approximate).
  amountDisplay: string;
  /// JS Date for the time-window evaluator. Defaults to "now"
  /// if omitted.
  at?: Date;
}

const decoder = new TextDecoder();

/// Evaluate every enabled rule against the candidate. Returns the
/// FIRST matching rule plus full reasoning, or null when nothing
/// matches.
export async function evaluateFirstMatch(
  rules: PolicyRule[],
  candidate: CandidateProposal,
): Promise<RuleEvaluation | null> {
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const conditions = await decryptConditions(rule.conditions);
    const reasons: RuleEvaluation["reasons"] = [];
    let matched = true;
    for (const cond of conditions) {
      const r = matchCondition(cond, candidate);
      reasons.push(r);
      if (!r.matched) matched = false;
    }
    if (matched) {
      return {
        ruleId: rule.id,
        ruleName: rule.name,
        matched: true,
        reasons,
        action: rule.action,
      };
    }
  }
  return null;
}

/// Evaluate every enabled rule. Useful for the Policies list view
/// to show "this rule would fire on a fresh send" indicators.
/// Order matches the input rules (don't re-sort here).
export async function evaluateAll(
  rules: PolicyRule[],
  candidate: CandidateProposal,
): Promise<RuleEvaluation[]> {
  const out: RuleEvaluation[] = [];
  for (const rule of rules) {
    const conditions = rule.enabled
      ? await decryptConditions(rule.conditions)
      : rule.conditions;
    const reasons: RuleEvaluation["reasons"] = [];
    let matched = rule.enabled;
    for (const cond of conditions) {
      const r = matchCondition(cond, candidate);
      reasons.push(r);
      if (!r.matched) matched = false;
    }
    out.push({
      ruleId: rule.id,
      ruleName: rule.name,
      matched,
      reasons,
      action: rule.action,
    });
  }
  return out;
}

// ── per-condition matchers ──────────────────────────────────────

function matchCondition(
  cond: RuleCondition,
  candidate: CandidateProposal,
): { condition: string; matched: boolean; detail?: string } {
  switch (cond.kind) {
    case "asset":
      return matchAsset(cond, candidate);
    case "recipient":
      return matchRecipient(cond, candidate);
    case "amount":
      return matchAmount(cond, candidate);
    case "time-window":
      return matchTimeWindow(cond, candidate);
    case "velocity":
      return matchVelocity(cond, candidate);
  }
}

function matchAsset(
  c: AssetCondition,
  candidate: CandidateProposal,
): { condition: string; matched: boolean; detail?: string } {
  if (c.chainKind === null) {
    return { condition: "asset", matched: true, detail: "any chain" };
  }
  if (c.chainKind !== candidate.chainKind) {
    return {
      condition: "asset",
      matched: false,
      detail: `chain ${candidate.chainKind} ≠ ${c.chainKind}`,
    };
  }
  if (c.tokenContract && candidate.chainKind === 4) {
    const want = c.tokenContract.toLowerCase();
    const got = (candidate.tokenContract ?? "").toLowerCase();
    if (want !== got) {
      return {
        condition: "asset",
        matched: false,
        detail: `token ${got} ≠ ${want}`,
      };
    }
  }
  return { condition: "asset", matched: true };
}

function matchRecipient(
  c: RecipientCondition,
  candidate: CandidateProposal,
): { condition: string; matched: boolean; detail?: string } {
  const list = (c.addresses ?? []).map((a) => a.toLowerCase());
  // EVM addresses are case-insensitive; Solana base58 is
  // case-sensitive. Lowercase comparison is a slight false-positive
  // risk on Solana but only matters if a user typed two distinct
  // base58 strings that differ only in case (unlikely).
  const got = candidate.recipient.toLowerCase();
  const inList = list.includes(got);
  const matched = c.mode === "allowlist" ? inList : !inList;
  return {
    condition: "recipient",
    matched,
    detail: matched
      ? c.mode === "allowlist"
        ? "in allowlist"
        : "not in blocklist"
      : c.mode === "allowlist"
        ? "not in allowlist"
        : "in blocklist",
  };
}

function matchAmount(
  c: AmountCondition,
  candidate: CandidateProposal,
): { condition: string; matched: boolean; detail?: string } {
  const amount = parseFloat(candidate.amountDisplay);
  if (!Number.isFinite(amount)) {
    return { condition: "amount", matched: false, detail: "invalid amount" };
  }
  if (c.ticker && candidate.ticker && c.ticker !== candidate.ticker) {
    // Mismatched ticker - rule doesn't apply (treat as no-match
    // not as "denied").
    return {
      condition: "amount",
      matched: false,
      detail: `ticker ${candidate.ticker} ≠ ${c.ticker}`,
    };
  }
  if (c.minDisplay != null) {
    const min = parseFloat(c.minDisplay);
    if (Number.isFinite(min) && amount < min) {
      return {
        condition: "amount",
        matched: false,
        detail: `${amount} < ${min}`,
      };
    }
  }
  if (c.maxDisplay != null) {
    const max = parseFloat(c.maxDisplay);
    if (Number.isFinite(max) && amount > max) {
      return {
        condition: "amount",
        matched: false,
        detail: `${amount} > ${max}`,
      };
    }
  }
  return { condition: "amount", matched: true };
}

function matchTimeWindow(
  c: TimeWindowCondition,
  candidate: CandidateProposal,
): { condition: string; matched: boolean; detail?: string } {
  const at = candidate.at ?? new Date();
  const hour = at.getHours();
  const day = at.getDay();
  const dayOk =
    c.daysOfWeek.length === 0 || c.daysOfWeek.includes(day);
  if (!dayOk) {
    return {
      condition: "time-window",
      matched: c.match === "outside",
      detail: "day not in window",
    };
  }
  const inside =
    c.startHour <= c.endHour
      ? hour >= c.startHour && hour < c.endHour
      : hour >= c.startHour || hour < c.endHour;
  const matched = c.match === "inside" ? inside : !inside;
  return {
    condition: "time-window",
    matched,
    detail: matched ? "in window" : "out of window",
  };
}

function matchVelocity(
  c: VelocityCondition,
  candidate: CandidateProposal,
): { condition: string; matched: boolean; detail?: string } {
  if (c.ticker && candidate.ticker && c.ticker !== candidate.ticker) {
    return {
      condition: "velocity",
      matched: false,
      detail: `ticker ${candidate.ticker} ≠ ${c.ticker}`,
    };
  }
  // Sum recent successful sends from the localStorage tx log for
  // this wallet+ticker over the rolling window. This is a
  // best-effort client-side approximation; real on-chain
  // enforcement reads chain state via FHE.
  const cutoff = Date.now() - c.windowDays * 24 * 60 * 60 * 1000;
  const attempts = listAttempts(candidate.walletName);
  let total = 0;
  for (const a of attempts) {
    if (a.status !== "success") continue;
    if (a.ts < cutoff) continue;
    if (a.ticker && c.ticker && a.ticker !== c.ticker) continue;
    const v = parseFloat(a.amountDisplay ?? "0");
    if (Number.isFinite(v)) total += v;
  }
  const candidateAmount = parseFloat(candidate.amountDisplay) || 0;
  const projected = total + candidateAmount;
  const cap = parseFloat(c.capDisplay);
  const matched = Number.isFinite(cap) && projected > cap;
  return {
    condition: "velocity",
    matched,
    detail: matched
      ? `${projected.toFixed(4)} ${c.ticker} > ${c.capDisplay} cap (${c.windowDays}d)`
      : `${projected.toFixed(4)} ${c.ticker} ≤ ${c.capDisplay} cap (${c.windowDays}d)`,
  };
}

/// Convenience: collapse an evaluation into the action a UI should
/// take. "deny" is hard-stop; "require-*" surfaces extra friction
/// banners; "allow" / null means proceed normally.
export function effectiveAction(
  evaluation: RuleEvaluation | null,
): RuleAction | null {
  return evaluation?.matched ? evaluation.action : null;
}

// Suppress unused-import warning when textDecoder isn't called
// directly (kept around for future condition shapes that decrypt
// in-place rather than via encryption.ts).
void decoder;
