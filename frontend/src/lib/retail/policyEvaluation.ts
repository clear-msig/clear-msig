"use client";

// Unified policy pre-flight check.
//
// Every signed send hits this before the wallet popup opens. If any
// rule fails, the send aborts with a friendly violation that the UI
// surfaces as a toast — the user never reaches the signature step on
// a doomed send.
//
// Sources of truth:
//   - getAllowlist(walletName)         (lib/retail/policy.ts)
//   - getTimeWindow(walletName)        (lib/retail/policy.ts)
//   - getAllowance(walletName, friend) (lib/retail/allowances.ts)
//   - getBudget(walletName)            (lib/retail/spendingBudget.ts)
//
// Enforcement is client-side. A user with DevTools can defeat any of
// these. /SECURITY.md and the /policy chips disclose this.

import { getAllowlist, getTimeWindow, isInsideTimeWindow } from "@/lib/retail/policy";
import { getAllowance } from "@/lib/retail/allowances";
import {
  getBudget,
  computeWindowStart,
  type WalletBudget,
} from "@/lib/retail/spendingBudget";
import { quotePerWhole } from "@/lib/retail/priceConversion";

export type PolicyViolationCode =
  | "recipient_not_allowed"
  | "outside_time_window"
  | "exceeds_friend_allowance"
  | "exceeds_weekly_budget"
  | "exceeds_chain_budget";

export interface PolicyViolation {
  code: PolicyViolationCode;
  /// Short headline for the toast.
  title: string;
  /// One-sentence detail explaining why + what to do.
  body: string;
}

/// Throwable wrapper. The send flow throws this from inside its
/// mutationFn so the caller's onError gets a typed error to surface.
/// `friendlyError` recognises it and renders the violation directly
/// instead of falling through to a generic "Couldn't send".
export class PolicyViolationError extends Error {
  code: PolicyViolationCode;
  body: string;
  /// All violations on this attempt (not just the first). UI can list
  /// them when the user has multiple rules tripping at once.
  violations: PolicyViolation[];
  constructor(violations: PolicyViolation[]) {
    const first = violations[0];
    super(first?.title ?? "Send blocked by wallet policy");
    this.name = "PolicyViolationError";
    this.code = first?.code ?? "recipient_not_allowed";
    this.body = first?.body ?? "";
    this.violations = violations;
  }
}

export interface PolicyCheckInput {
  walletName: string;
  recipientAddress: string;
  /// Optional. Used for budget + allowance enforcement when set.
  amountSol?: number;
  /// USD ticker for chain-specific cap checks. Defaults to "SOL".
  ticker?: string;
  /// Already-spent USD this window for the wallet. Caller passes
  /// this from useWalletBudgetUsage to avoid redundant chain reads.
  spentUsdThisWindow?: number;
  /// Per-chain spent. Same source.
  spentUsdByChain?: Partial<Record<string, number>>;
  /// Defaults to Date.now(). Override in tests.
  nowMs?: number;
}

export interface PolicyEvaluation {
  ok: boolean;
  violations: PolicyViolation[];
  /// True when at least one client-side rule is configured for this
  /// wallet. The UI uses this to badge "policy active" on /send.
  hasActiveRules: boolean;
}

export function evaluatePolicy(input: PolicyCheckInput): PolicyEvaluation {
  const violations: PolicyViolation[] = [];
  const now = new Date(input.nowMs ?? Date.now());

  // 1. Allowlist.
  const allowlist = getAllowlist(input.walletName);
  if (allowlist.mode === "on") {
    if (!allowlist.addresses.includes(input.recipientAddress)) {
      violations.push({
        code: "recipient_not_allowed",
        title: "That recipient isn't on the allowlist",
        body:
          "This wallet only sends to addresses on its allowlist. Add the " +
          "recipient on the policy page first, or send from a wallet that " +
          "doesn't have the allowlist on.",
      });
    }
  }

  // 2. Time window.
  const window = getTimeWindow(input.walletName);
  if (window.enabled) {
    if (!isInsideTimeWindow(window, now)) {
      violations.push({
        code: "outside_time_window",
        title: "Outside the wallet's allowed sending hours",
        body: formatTimeWindowBody(window),
      });
    }
  }

  // 3. Per-friend allowance.
  if (typeof input.amountSol === "number" && input.amountSol > 0) {
    const allowance = getAllowance(input.walletName, input.recipientAddress);
    if (allowance && allowance.period !== "none") {
      if (input.amountSol > allowance.amountSol) {
        violations.push({
          code: "exceeds_friend_allowance",
          title: "Over this friend's allowance",
          body:
            `${formatSol(allowance.amountSol)} ${allowance.period === "weekly" ? "per week" : "per month"} ` +
            `is the cap for this address. This send is ${formatSol(input.amountSol)}.`,
        });
      }
    }
  }

  // 4. Wallet-wide and per-chain budget caps.
  const budget = getBudget(input.walletName);
  if (
    budget &&
    typeof input.amountSol === "number" &&
    input.amountSol > 0
  ) {
    const ticker = (input.ticker ?? "SOL").toUpperCase();
    const usdForThisSend = solishToUsd(input.amountSol, ticker);
    if (usdForThisSend !== null) {
      // Wallet-wide.
      const spent = input.spentUsdThisWindow ?? 0;
      if (
        budget.weeklyUsd !== null &&
        budget.weeklyUsd > 0 &&
        spent + usdForThisSend > budget.weeklyUsd
      ) {
        violations.push({
          code: "exceeds_weekly_budget",
          title: "Over the wallet's weekly cap",
          body:
            `This send (${formatUsd(usdForThisSend)}) on top of ${formatUsd(spent)} ` +
            `already spent would push past ${formatUsd(budget.weeklyUsd)} this week.`,
        });
      }
      // Per-chain. The budget keys on a closed enum of tickers; cast
      // narrows safely because the lookup just falls through when ticker
      // isn't one we know.
      const chainCap = (
        budget.perChainUsd as Record<string, number | null | undefined> | undefined
      )?.[ticker];
      if (chainCap !== undefined && chainCap !== null && chainCap > 0) {
        const chainSpent = input.spentUsdByChain?.[ticker] ?? 0;
        if (chainSpent + usdForThisSend > chainCap) {
          violations.push({
            code: "exceeds_chain_budget",
            title: `Over the ${ticker} cap`,
            body:
              `${ticker} cap is ${formatUsd(chainCap)} this week. ${formatUsd(chainSpent)} already spent + ` +
              `this ${formatUsd(usdForThisSend)} send would exceed it.`,
          });
        }
      }
    }
  }

  return {
    ok: violations.length === 0,
    violations,
    hasActiveRules: hasAnyActiveRule(input.walletName, budget),
  };
}

function hasAnyActiveRule(walletName: string, budget: WalletBudget | null): boolean {
  if (getAllowlist(walletName).mode === "on") return true;
  if (getTimeWindow(walletName).enabled) return true;
  if (budget && (budget.weeklyUsd ?? 0) > 0) return true;
  return false;
}

function solishToUsd(amount: number, ticker: string): number | null {
  const q = quotePerWhole(ticker);
  if (!q) return null;
  return amount * q.usdPerWhole;
}

function formatSol(amount: number): string {
  if (amount >= 1) return `${amount.toLocaleString("en-US")} SOL`;
  return `${amount} SOL`;
}

function formatUsd(usd: number): string {
  if (!isFinite(usd)) return "$—";
  if (usd >= 100) return `$${Math.round(usd).toLocaleString("en-US")}`;
  return `$${usd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatTimeWindowBody(w: { startHour: number; endHour: number; daysOfWeek: number[] }): string {
  const start = formatHour(w.startHour);
  const end = formatHour(w.endHour);
  if (w.daysOfWeek.length === 7) {
    return `Sends are allowed only between ${start} and ${end}. Try again then.`;
  }
  if (w.daysOfWeek.length === 0) {
    return "Sends are blocked on every day of the week. Update the policy first.";
  }
  return `Sends are allowed only between ${start} and ${end} on selected days. Try again then.`;
}

function formatHour(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const display = h % 12 === 0 ? 12 : h % 12;
  return `${display}${period}`;
}

/// Helper: keep the "what window are we in" computation co-located.
export { computeWindowStart };
