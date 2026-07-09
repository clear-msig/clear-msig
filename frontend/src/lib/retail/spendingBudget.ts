"use client";

// Per-wallet spending policy. The cross-chain moat.
//
// v1 was a single number: "{wallet} can spend $X per week, total."
// v2 layers two more dimensions on top of that single cap:
//
//   1. Per-chain caps. "Up to $5k/wk on Solana, $10k/wk on Ethereum,
//      $1k/wk on Bitcoin." A user can leave a chain unspecified
//      (null), which means "no chain-level limit; the wallet-wide
//      cap is the only ceiling."
//   2. Daily velocity. "At most N sends in 24 hours." Catches both
//      runaway-script attacks and impulse-spend behaviour. null
//      means "no per-day count limit."
//
// The editor stores a native-token snapshot for each USD cap. Typed send
// proposals include that stable snapshot in their committed policy bytes,
// and the program enforces the rolling amount and send-count windows.

const STORAGE_KEY = "clear-msig:spending-budget:v1";

/// Rolling window length for the wallet-wide and per-chain caps.
/// 7 calendar days, denominated in ms so math with `Date.now()` is
/// straightforward.
export const BUDGET_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/// Window for the velocity (sends-per-day) limit. 24 hours.
export const VELOCITY_WINDOW_MS = 24 * 60 * 60 * 1000;

/// Tickers we currently know how to price. Drives the per-chain UI
/// and the breakdown buckets. Add to this when a new chain template
/// gets a price oracle entry in priceConversion.ts.
export const POLICY_CHAIN_TICKERS = ["SOL", "ETH", "BTC", "ZEC", "HYPE"] as const;
export type PolicyChainTicker = (typeof POLICY_CHAIN_TICKERS)[number];

export interface WalletBudget {
  walletName: string;
  /// Wallet-wide weekly cap in USD. `null` means "no overall limit
  /// explicitly set"; distinct from `0` which locks the wallet.
  weeklyUsd: number | null;
  /// Per-chain weekly caps in USD, keyed by ticker. Missing or null
  /// keys mean "no per-chain cap". The wallet-wide cap still applies
  /// independently of these.
  perChainUsd?: Partial<Record<PolicyChainTicker, number | null>>;
  /// Stable native-token equivalents captured when the user saves. These
  /// values are signed into typed sends, avoiding policy resets as spot prices
  /// move between requests.
  onchainWeeklyNative?: Partial<Record<PolicyChainTicker, string | null>>;
  /// Maximum number of executed sends per 24-hour rolling window.
  /// `null` means no velocity limit. Catches "I just signed 50
  /// approvals" pattern when something is off.
  velocityPerDay?: number | null;
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

/// Replace any existing budget for this wallet with the supplied
/// fields. Pass undefined for fields you want to leave at default
/// (null/missing); pass null to explicitly clear a previously-set cap.
export interface SaveBudgetInput {
  walletName: string;
  weeklyUsd?: number | null;
  perChainUsd?: Partial<Record<PolicyChainTicker, number | null>>;
  onchainWeeklyNative?: Partial<Record<PolicyChainTicker, string | null>>;
  velocityPerDay?: number | null;
}

export function saveBudget(input: SaveBudgetInput): WalletBudget;
/// Back-compat overload for the v1 call site that passed
/// `(walletName, weeklyUsd)` positionally.
export function saveBudget(walletName: string, weeklyUsd: number | null): WalletBudget;
export function saveBudget(
  arg0: SaveBudgetInput | string,
  arg1?: number | null,
): WalletBudget {
  const input: SaveBudgetInput =
    typeof arg0 === "string"
      ? { walletName: arg0, weeklyUsd: arg1 ?? null }
      : arg0;
  const all = loadAll();
  const existing = all.find((r) => r.walletName === input.walletName);
  const next: WalletBudget = {
    walletName: input.walletName,
    weeklyUsd:
      input.weeklyUsd !== undefined ? input.weeklyUsd : (existing?.weeklyUsd ?? null),
    perChainUsd: mergeChainCaps(existing?.perChainUsd, input.perChainUsd),
    onchainWeeklyNative: mergeNativeCaps(
      existing?.onchainWeeklyNative,
      input.onchainWeeklyNative,
    ),
    velocityPerDay:
      input.velocityPerDay !== undefined
        ? input.velocityPerDay
        : (existing?.velocityPerDay ?? null),
    updatedAt: Date.now(),
  };
  const rest = all.filter((r) => r.walletName !== input.walletName);
  rest.push(next);
  persist(rest);
  return next;
}

function mergeNativeCaps(
  existing: Partial<Record<PolicyChainTicker, string | null>> | undefined,
  patch: Partial<Record<PolicyChainTicker, string | null>> | undefined,
): Partial<Record<PolicyChainTicker, string | null>> | undefined {
  if (!patch) return existing;
  const out: Partial<Record<PolicyChainTicker, string | null>> = { ...existing };
  for (const ticker of POLICY_CHAIN_TICKERS) {
    if (ticker in patch) out[ticker] = patch[ticker];
  }
  return out;
}

function mergeChainCaps(
  existing: Partial<Record<PolicyChainTicker, number | null>> | undefined,
  patch: Partial<Record<PolicyChainTicker, number | null>> | undefined,
): Partial<Record<PolicyChainTicker, number | null>> | undefined {
  if (!patch) return existing;
  const out: Partial<Record<PolicyChainTicker, number | null>> = { ...existing };
  for (const ticker of POLICY_CHAIN_TICKERS) {
    if (ticker in patch) out[ticker] = patch[ticker];
  }
  return out;
}

export interface BudgetUsageWindow {
  /// Total USD spent across all chains in the rolling weekly window.
  spentUsd: number;
  /// Counts of underlying proposals folded into spentUsd.
  proposalCount: number;
  /// The window's left edge as a unix timestamp (ms). Anything older
  /// is excluded.
  windowStartMs: number;
}

export function computeWindowStart(now = Date.now()): number {
  return now - BUDGET_WINDOW_MS;
}

export function computeVelocityWindowStart(now = Date.now()): number {
  return now - VELOCITY_WINDOW_MS;
}

export interface PriceableSpend {
  executedAtMs: number;
  usd: number;
  /// Chain ticker (SOL/ETH/BTC/ZEC/HYPE) so the per-chain breakdown can
  /// bucket the spend. Unknown tickers are still summed in the
  /// wallet-wide total.
  ticker: PolicyChainTicker | string;
}

/// Sum the USD value of every executed proposal in the rolling
/// weekly window across all chains.
export function sumWindowUsd(
  rows: ReadonlyArray<PriceableSpend>,
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

/// Bucket spend by chain ticker. Same window as sumWindowUsd; useful
/// for the per-chain progress bars and the sign-time impact preview.
export function sumWindowUsdByChain(
  rows: ReadonlyArray<PriceableSpend>,
  now = Date.now(),
): Record<string, number> {
  const windowStartMs = computeWindowStart(now);
  const out: Record<string, number> = {};
  for (const r of rows) {
    if (r.executedAtMs < windowStartMs) continue;
    if (r.usd <= 0) continue;
    out[r.ticker] = (out[r.ticker] ?? 0) + r.usd;
  }
  return out;
}

/// Count executed sends in the velocity window. Used by the per-day
/// rate limit hint.
export function countWindowSends(
  rows: ReadonlyArray<{ executedAtMs: number }>,
  now = Date.now(),
): number {
  const windowStartMs = computeVelocityWindowStart(now);
  let n = 0;
  for (const r of rows) {
    if (r.executedAtMs < windowStartMs) continue;
    n += 1;
  }
  return n;
}

function isBudget(r: unknown): r is WalletBudget {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  if (typeof o.walletName !== "string") return false;
  if (typeof o.updatedAt !== "number") return false;
  if (o.weeklyUsd !== null && typeof o.weeklyUsd !== "number") return false;
  // Optional v2 fields. Older v1 records have neither; both are valid.
  if (
    o.perChainUsd !== undefined &&
    (typeof o.perChainUsd !== "object" || o.perChainUsd === null)
  ) {
    return false;
  }
  if (
    o.velocityPerDay !== undefined &&
    o.velocityPerDay !== null &&
    typeof o.velocityPerDay !== "number"
  ) {
    return false;
  }
  if (
    o.onchainWeeklyNative !== undefined &&
    (typeof o.onchainWeeklyNative !== "object" ||
      o.onchainWeeklyNative === null)
  ) {
    return false;
  }
  return true;
}
