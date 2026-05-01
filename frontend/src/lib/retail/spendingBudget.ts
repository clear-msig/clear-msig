"use client";

// Per-wallet weekly spending budget — the cross-chain moat.
//
// "5 ETH OR 50k USDC OR 0.1 BTC per week, total cap" sounds like a
// spec; for retail it's just "this wallet can spend $5,000 a week."
// One number, denominated in dollars. The UI sums every executed
// proposal's USD value over the rolling 7-day window and compares
// to the cap.
//
// Stored locally because the on-chain Custom intent doesn't yet
// carry a wallet-wide budget field. Same migration path as
// allowances.ts and walletAppearance.ts — when the program adds a
// `weekly_spend_cap_usd` (or its FHE-encrypted equivalent), this
// module becomes a cache that proxies through the backend. Single
// swap point.
//
// Why advisory v1 instead of waiting for the program: the user can
// already SEE their cap going up against actual usage, which is the
// behavior change that makes the moat stick. Real prevention lands
// when the program enforces it; today it's a nudge.

const STORAGE_KEY = "clear-msig:spending-budget:v1";

/// Rolling window length. 7 calendar days, denominated in ms so
/// math with `Date.now()` is straightforward.
export const BUDGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface WalletBudget {
  walletName: string;
  /// Weekly cap in USD. `null` means "no limit explicitly set" —
  /// distinct from `0`, which the UI shouldn't render as "set" but
  /// is technically valid (locks the wallet).
  weeklyUsd: number | null;
  updatedAt: number;
}

function loadAll(): WalletBudget[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isBudget);
  } catch {
    return [];
  }
}

function persist(rows: WalletBudget[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Quota / privacy mode failures aren't worth blocking on.
  }
}

export function getBudget(walletName: string): WalletBudget | null {
  return loadAll().find((r) => r.walletName === walletName) ?? null;
}

export function saveBudget(walletName: string, weeklyUsd: number | null): WalletBudget {
  const all = loadAll();
  const next: WalletBudget = {
    walletName,
    weeklyUsd,
    updatedAt: Date.now(),
  };
  const rest = all.filter((r) => r.walletName !== walletName);
  rest.push(next);
  persist(rest);
  return next;
}

export interface BudgetUsageWindow {
  /// Total USD spent across all chains in the rolling window.
  spentUsd: number;
  /// Counts of underlying proposals folded into spentUsd. Useful for
  /// the UI ("$120 across 3 sends this week").
  proposalCount: number;
  /// The window's left edge, as a unix timestamp (ms). Anything
  /// older than this isn't counted.
  windowStartMs: number;
}

export function computeWindowStart(now = Date.now()): number {
  return now - BUDGET_WINDOW_MS;
}

/// Sum the USD value of every executed proposal in the rolling
/// window. Caller hands us a flat list of `{ executedAtMs, usd }`
/// pairs (derived from useRecentActivity + price conversion at the
/// call site so this module stays storage-only and easy to test).
export function sumWindowUsd(
  rows: ReadonlyArray<{ executedAtMs: number; usd: number }>,
  now = Date.now(),
): BudgetUsageWindow {
  const windowStartMs = computeWindowStart(now);
  let spentUsd = 0;
  let proposalCount = 0;
  for (const r of rows) {
    if (r.executedAtMs < windowStartMs) continue;
    if (r.usd <= 0) continue;
    spentUsd += r.usd;
    proposalCount += 1;
  }
  return { spentUsd, proposalCount, windowStartMs };
}

function isBudget(r: unknown): r is WalletBudget {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    typeof o.updatedAt === "number" &&
    (o.weeklyUsd === null || typeof o.weeklyUsd === "number")
  );
}
