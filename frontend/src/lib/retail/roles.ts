"use client";

// Per-friend role within a shared wallet.
//
// The on-chain intent has two member lists: `proposers` (can create
// requests) and `approvers` (whose signatures count toward quorum).
// Combine them and you get three useful retail roles:
//
//   - "full"     → in both lists. Default for "Add a friend".
//   - "approver" → only in approvers. Read + approve, can't initiate.
//   - "watcher"  → in neither list. Stored locally because the chain
//                  has no "watcher" concept; the wallet state is
//                  already public, so a watcher is just a saved
//                  contact pinned to a specific wallet for display.
//
// The first two are derived from the on-chain intent on render. The
// "watcher" set is stored here in localStorage and merged in when
// the members page renders.

const STORAGE_KEY = "clear-msig:watchers:v1";

export type Role = "full" | "approver" | "watcher";

export interface Watcher {
  walletName: string;
  /// Friend's Solana base58.
  address: string;
  /// Saved name (matches the contact entry if one exists).
  name: string;
  /// Set on insert so the members page can sort or show "added 2d ago".
  addedAt: number;
}

function loadAll(): Watcher[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWatcher);
  } catch {
    return [];
  }
}

function persist(rows: Watcher[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // Storage failures aren't worth blocking on.
  }
}

export function listWatchers(walletName?: string): Watcher[] {
  const all = loadAll();
  return walletName ? all.filter((w) => w.walletName === walletName) : all;
}

export function addWatcher(input: { walletName: string; address: string; name: string }): Watcher {
  const all = loadAll();
  const existing = all.find(
    (w) => w.walletName === input.walletName && w.address === input.address,
  );
  if (existing) {
    // Refresh the saved name in case the user re-saved with a new name.
    existing.name = input.name;
    persist(all);
    return existing;
  }
  const w: Watcher = { ...input, addedAt: Date.now() };
  all.push(w);
  persist(all);
  return w;
}

export function removeWatcher(walletName: string, address: string) {
  const all = loadAll();
  persist(all.filter((w) => !(w.walletName === walletName && w.address === address)));
}

/// Determine a friend's role given the on-chain intent + the
/// per-wallet watchers list. Used by the members page to display
/// the role badge next to each name.
export function deriveRole(
  address: string,
  proposers: string[],
  approvers: string[],
  watchersForWallet: Watcher[],
): Role | "unknown" {
  const inProposers = proposers.includes(address);
  const inApprovers = approvers.includes(address);
  if (inProposers && inApprovers) return "full";
  if (inApprovers) return "approver";
  if (watchersForWallet.some((w) => w.address === address)) return "watcher";
  return "unknown";
}

export const ROLE_LABEL: Record<Role, string> = {
  full: "Can spend & approve",
  approver: "Can approve",
  watcher: "Can watch",
};

export const ROLE_HINT: Record<Role, string> = {
  full: "Creates requests AND signs approvals",
  approver: "Signs approvals but doesn't create requests",
  watcher: "Sees activity but never signs",
};

function isWatcher(r: unknown): r is Watcher {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    typeof o.address === "string" &&
    typeof o.name === "string" &&
    typeof o.addedAt === "number"
  );
}
