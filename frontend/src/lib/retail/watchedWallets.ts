"use client";

// Per-device watch list of clear-msig wallets the user wants to
// follow without being a member. Treasury use cases:
//
//   - A treasurer watches subordinate wallets they don't sign on.
//   - A partner watches a shared wallet without being on its
//     approver list.
//   - Auditors watch ops wallets read-only.
//
// What's stored: just the wallet name (with its on-chain
// creator-derived suffix). The wallet hub re-fetches each watched
// wallet's on-chain account on every page mount, so adding a
// wallet here is a one-line localStorage change — no rehydration
// of stale balances.
//
// What's NOT stored: any sign-capable material. Watching is
// strictly read-only — the existing pickSigner() check on the
// send / approve / setup flows refuses to sign when the user
// isn't in the approver list, so a "watcher" can browse the UI
// but can't take any action that mutates state.

const STORAGE_KEY = "clear.watched-wallets.v1";
const MAX_WATCHED = 100;

export interface WatchedWallet {
  /// On-chain wallet name (carries the `#XXXXXX` creator-derived
  /// suffix). Used as a stable identifier + the URL slug.
  name: string;
  /// Unix ms when added — for sort order in the UI.
  addedAt: number;
}

function isWatched(x: unknown): x is WatchedWallet {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return typeof r.name === "string" && typeof r.addedAt === "number";
}

export function loadWatchedWallets(): WatchedWallet[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWatched);
  } catch {
    return [];
  }
}

function persist(rows: WatchedWallet[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = rows.slice(-MAX_WATCHED);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new Event("clear:watched-wallets-changed"));
  } catch {
    /* localStorage full or blocked — silently noop */
  }
}

/// Add `name` to the watch list. No-op if already present (so the
/// `addedAt` of the original entry isn't disturbed). Returns true
/// when an actual write happened.
export function addWatchedWallet(name: string): boolean {
  const trimmed = name.trim();
  if (!trimmed) return false;
  const list = loadWatchedWallets();
  if (list.some((w) => w.name === trimmed)) return false;
  list.push({ name: trimmed, addedAt: Date.now() });
  persist(list);
  return true;
}

export function removeWatchedWallet(name: string): void {
  persist(loadWatchedWallets().filter((w) => w.name !== name));
}

/// Subscribe to watch-list changes — fires on this tab (via the
/// custom event we dispatch above) AND other tabs (via `storage`).
export function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener("clear:watched-wallets-changed", handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener("clear:watched-wallets-changed", handler);
    window.removeEventListener("storage", handler);
  };
}
