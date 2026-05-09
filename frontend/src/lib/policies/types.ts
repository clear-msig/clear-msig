"use client";

// Policy-rule type system. Inspired by Fordefi's policy-rule shape
// (https://docs.fordefi.com/user-guide/policies/create-a-policy-rule)
// - conditions describe WHEN a rule fires, action describes WHAT
// happens. Adapted for the clear-msig domain: a rule lives under a
// specific wallet, augments the on-chain intent (which carries the
// approver set + base threshold), and adds finer-grained checks
// that today are evaluated client-side before the user signs.
//
// Encryption story (matches docs.encrypt.xyz pre-alpha):
//   - Condition VALUES (allowlist addresses, amount caps, time
//     windows, velocity caps) live as ciphertext identifiers
//     produced by encryptPolicyBatch.
//   - Rule METADATA (name, action, condition shape) stays in the
//     clear so the UI can render the rule without round-tripping
//     decrypt for every list view.
//
// What this is NOT today:
//   - Enforced on chain. The clear-wallet program has no FHE
//     handlers yet. Rules apply at compose-time as a pre-flight
//     check before the user fires the wallet popup; a member of
//     the multisig who skips the UI can still propose anyway. The
//     tripwire becomes load-bearing once Encrypt's `#[encrypt_fn]`
//     EUint slots land + the program reads policy ciphertexts.
//   - Synced across devices. Each user's policy rules live in
//     their own browser localStorage. When on-chain enforcement
//     ships, the rules become a single source of truth visible to
//     everyone in the multisig.

import type { EncryptedPayload } from "@/lib/encrypt/client";

/// Rule version - bumped when the condition shape evolves so older
/// stored rules can be migrated or skipped without crashing the
/// evaluator.
export type RuleVersion = 1;

/// Action the rule takes when its conditions match a candidate
/// proposal. The names track Fordefi's vocabulary for familiarity.
export type RuleAction =
  /// Block the proposal at compose-time. The user sees a clear
  /// "your wallet's policy denies this send" banner and can't sign.
  | "deny"
  /// Allow with the wallet's existing threshold. This is the
  /// implicit default for a proposal with no matching rule;
  /// surfacing it as an action lets users build "allowlist this
  /// recipient, deny everyone else" by ordering rules.
  | "allow"
  /// Require additional approvers on top of the on-chain
  /// threshold. Today the additional approvers are recorded in
  /// the rule but enforced as a UI banner pre-sign; on-chain
  /// enforcement is the FHE follow-up.
  | "require-extra-approvers"
  /// Add a wait time on top of the intent's timelock. Same
  /// caveat - UI-only today.
  | "require-cooldown";

// ── Conditions ──────────────────────────────────────────────────

/// Restrict the rule to a chain (or all chains).
export interface AssetCondition {
  kind: "asset";
  /// Chain kind from the program's enum (0 SOL, 1 EVM, 2 BTC, 3 ZEC,
  /// 4 ERC-20). Null means "any chain".
  chainKind: number | null;
  /// For chain_kind=4 (ERC-20), optionally restrict to a specific
  /// token contract. Lowercased 0x address.
  tokenContract?: string | null;
}

/// Allow- or block-list of recipients. Addresses normalised to
/// lowercase for EVM, base58 for Solana. Encrypted at rest.
export interface RecipientCondition {
  kind: "recipient";
  mode: "allowlist" | "blocklist";
  /// Plaintext addresses for in-memory editing; the persisted
  /// rule replaces this with `encryptedAddresses`.
  addresses?: string[];
  /// Ciphertext identifiers for each entry, in the same order.
  encryptedAddresses?: EncryptedPayload[];
}

/// Amount window. Bounds optional; either or both may be set.
/// Stored as decimal-string to avoid bigint serialization issues.
export interface AmountCondition {
  kind: "amount";
  /// Inclusive lower bound in display units (e.g. "0.01" SOL).
  /// Null means no lower bound.
  minDisplay?: string | null;
  /// Inclusive upper bound in display units.
  maxDisplay?: string | null;
  /// Ticker the bounds are denominated in - provides UI display
  /// + sanity-checks the bounds belong to the asset filter above
  /// when both are set.
  ticker?: string | null;
}

/// Time-of-day + days-of-week window. Hours are local to the
/// device (UI shows the mismatch to the user). Days are 0-6 with
/// Sunday=0 to match JS's getDay().
export interface TimeWindowCondition {
  kind: "time-window";
  /// 24h, 0–23. startHour < endHour means "during the day"; if
  /// startHour > endHour the window wraps midnight.
  startHour: number;
  endHour: number;
  /// Subset of [0..6]; empty means every day.
  daysOfWeek: number[];
  /// "inside"  - rule fires when the proposal's local time falls
  ///             inside the window.
  /// "outside" - fires only when OUTSIDE the window (useful for
  ///             "no sends overnight").
  match: "inside" | "outside";
}

/// Per-period spend cap. Today the rolling-window evaluation reads
/// localStorage tx attempts; on-chain enforcement reads on-chain
/// state via FHE.
export interface VelocityCondition {
  kind: "velocity";
  /// Cap, in display units of the same ticker as the asset filter.
  capDisplay: string;
  ticker: string;
  windowDays: 1 | 7 | 30;
}

export type RuleCondition =
  | AssetCondition
  | RecipientCondition
  | AmountCondition
  | TimeWindowCondition
  | VelocityCondition;

// ── Rule ────────────────────────────────────────────────────────

export interface PolicyRule {
  id: string;
  walletName: string;
  /// Display name. Plaintext.
  name: string;
  /// Optional free-text body. Plaintext.
  description?: string;
  /// Higher number = evaluated first. Ordering matters for the
  /// "first matching rule wins" Fordefi convention.
  priority: number;
  /// `true` when the rule is paused. Surfaces as a chip; the
  /// evaluator skips disabled rules without removing them.
  enabled: boolean;
  conditions: RuleCondition[];
  action: RuleAction;
  /// Used by the require-extra-approvers action. Each address must
  /// approve the proposal in addition to the on-chain threshold.
  /// Encrypted at rest.
  extraApproversEncrypted?: EncryptedPayload[];
  /// Used by the require-cooldown action. Additional seconds to
  /// wait beyond the intent's timelock.
  extraCooldownSeconds?: number;
  /// Unix ms of last edit.
  updatedAt: number;
  /// Unix ms of creation.
  createdAt: number;
  version: RuleVersion;
}

/// Result of evaluating a rule against a candidate proposal.
export interface RuleEvaluation {
  ruleId: string;
  ruleName: string;
  /// True if every condition matched.
  matched: boolean;
  /// Per-condition match detail - useful for the "why was this
  /// rule applied" affordance on the send page.
  reasons: Array<{ condition: string; matched: boolean; detail?: string }>;
  action: RuleAction;
}
