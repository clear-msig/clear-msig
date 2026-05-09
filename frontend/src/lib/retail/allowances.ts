"use client";

// Per-friend, per-wallet allowance metadata.
//
// "Sarah can spend up to $200/week from Roommates without extra
// scrutiny." Stored locally for now - the on-chain SolTransfer
// intent doesn't track per-approver allowances yet, so this is
// advisory: it drives the dashboard "X of Y allowance used"
// indicator and the warning chip on /send when a request would
// exceed the limit.
//
// Migration path: when the program grows an `allowance_per_approver`
// field on the intent, the chain becomes the source of truth and
// this module becomes a cache + edit surface that pushes updates
// through `intent update`.

const STORAGE_KEY = "clear-msig:allowances:v1";

export type AllowancePeriod = "weekly" | "monthly" | "none";

export interface FriendAllowance {
  /// Wallet name the limit applies to. A friend can have different
  /// limits in different shared wallets.
  walletName: string;
  /// Solana base58 of the friend.
  friendAddress: string;
  /// Cap in SOL. `0` is interpreted as "no spending allowed without
  /// extra approval"; use period="none" to mean "no limit".
  amountSol: number;
  period: AllowancePeriod;
  /// Set on every save so the UI can show "edited 2h ago".
  updatedAt: number;
}

function loadAll(): FriendAllowance[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAllowance);
  } catch {
    return [];
  }
}

function persist(rows: FriendAllowance[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Storage failures aren't worth blocking on - the in-memory
    // copy still works for the current session.
  }
}

export function listAllowances(walletName?: string): FriendAllowance[] {
  const all = loadAll();
  return walletName
    ? all.filter((r) => r.walletName === walletName)
    : all;
}

export function getAllowance(
  walletName: string,
  friendAddress: string,
): FriendAllowance | null {
  return (
    loadAll().find(
      (r) =>
        r.walletName === walletName && r.friendAddress === friendAddress,
    ) ?? null
  );
}

export function saveAllowance(
  input: Omit<FriendAllowance, "updatedAt">,
): FriendAllowance {
  const all = loadAll();
  const next = all.filter(
    (r) =>
      !(
        r.walletName === input.walletName &&
        r.friendAddress === input.friendAddress
      ),
  );
  const record: FriendAllowance = { ...input, updatedAt: Date.now() };
  next.push(record);
  persist(next);
  return record;
}

export function removeAllowance(
  walletName: string,
  friendAddress: string,
) {
  const all = loadAll();
  const next = all.filter(
    (r) =>
      !(r.walletName === walletName && r.friendAddress === friendAddress),
  );
  persist(next);
}

/// Shape for the period dropdown - order matters in the UI.
export const PERIOD_OPTIONS: Array<{
  value: AllowancePeriod;
  label: string;
  hint: string;
}> = [
  { value: "weekly", label: "Per week", hint: "Resets every Monday" },
  { value: "monthly", label: "Per month", hint: "Resets on the 1st" },
  { value: "none", label: "No limit", hint: "Unlimited spending" },
];

function isAllowance(r: unknown): r is FriendAllowance {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    typeof o.friendAddress === "string" &&
    typeof o.amountSol === "number" &&
    typeof o.updatedAt === "number" &&
    (o.period === "weekly" || o.period === "monthly" || o.period === "none")
  );
}
