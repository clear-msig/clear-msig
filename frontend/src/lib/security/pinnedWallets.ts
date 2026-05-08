"use client";

// Per-device set of wallet names the user has pinned. Pinned
// wallets sort to the top of /app/wallet so a treasury team in 5+
// multisigs can keep their daily one front-and-center without
// scrolling.
//
// Why localStorage:
//   - The on-chain Wallet account has no per-user "favorite" slot
//     and adding one would be a poor use of an account-rent byte.
//   - The pin is purely UI ergonomics — losing it on a fresh
//     device is no worse than losing tab order. A second device
//     gets a clean default.
//
// Storage shape: array of wallet *on-chain names* (the form that
// carries the creator-suffix). We stash names rather than PDAs
// because the rest of the wallet-list flow keys off names too —
// no extra translation step.

const STORAGE_KEY = "clear.pinned-wallets.v1";

function readAll(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === "string");
  } catch {
    return [];
  }
}

function writeAll(values: string[]): void {
  if (typeof window === "undefined") return;
  try {
    // Dedupe + cap at a sane max so a runaway loop can't blow
    // localStorage. 50 pins is well past any real treasury team's
    // working set.
    const dedup = Array.from(new Set(values)).slice(0, 50);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dedup));
    window.dispatchEvent(new Event("clear:pinned-wallets-changed"));
  } catch {
    /* quota / private-mode — silently noop */
  }
}

export function listPinnedWallets(): string[] {
  return readAll();
}

export function isWalletPinned(walletName: string): boolean {
  return readAll().includes(walletName);
}

export function pinWallet(walletName: string): void {
  const all = readAll();
  if (all.includes(walletName)) return;
  // Newest pin first — a small UX nicety so the user sees the row
  // they just pinned bubble to position #1 of the pinned group.
  writeAll([walletName, ...all]);
}

export function unpinWallet(walletName: string): void {
  const all = readAll();
  const next = all.filter((w) => w !== walletName);
  if (next.length === all.length) return;
  writeAll(next);
}

export function togglePinnedWallet(walletName: string): boolean {
  if (isWalletPinned(walletName)) {
    unpinWallet(walletName);
    return false;
  }
  pinWallet(walletName);
  return true;
}

export function subscribePinnedWallets(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("clear:pinned-wallets-changed", handler);
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("clear:pinned-wallets-changed", handler);
    window.removeEventListener("storage", onStorage);
  };
}

/// Sort an array of wallet-name-bearing items so that pinned
/// entries come first, in the order they were pinned. Stable for
/// non-pinned entries.
export function sortPinnedFirst<T>(
  items: T[],
  walletNameOf: (item: T) => string,
): T[] {
  const pinned = readAll();
  if (pinned.length === 0) return items;
  const rankByName = new Map<string, number>();
  pinned.forEach((name, i) => rankByName.set(name, i));
  const annotated = items.map((item, idx) => ({
    item,
    pinnedRank: rankByName.get(walletNameOf(item)),
    originalIdx: idx,
  }));
  annotated.sort((a, b) => {
    const aPin = a.pinnedRank;
    const bPin = b.pinnedRank;
    if (aPin !== undefined && bPin !== undefined) return aPin - bPin;
    if (aPin !== undefined) return -1;
    if (bPin !== undefined) return 1;
    return a.originalIdx - b.originalIdx;
  });
  return annotated.map((a) => a.item);
}
