"use client";

// Local notification feed.
//
// The app already has live pending-approval signals, but those are
// transient. This feed stores the last few notable wallet events per
// connected device so the dashboard can show an actual in-app inbox:
//   - new pending approval
//   - new request landed in one of the user's wallets
//   - membership / role changes

const STORAGE_PREFIX = "clear.notification-feed.v1.";
const MAX_ENTRIES = 200;

export type NotificationKind =
  | "pending_approval"
  | "wallet_request"
  | "membership_change";

export interface NotificationFeedEntry {
  id: string;
  kind: NotificationKind;
  walletName: string;
  title: string;
  body: string;
  href?: string;
  createdAt: number;
  seenAt?: number;
}

function key(userAddress: string): string {
  return STORAGE_PREFIX + userAddress;
}

function loadAll(userAddress: string): NotificationFeedEntry[] {
  if (typeof window === "undefined" || !userAddress) return [];
  try {
    const raw = window.localStorage.getItem(key(userAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry);
  } catch {
    return [];
  }
}

function persist(userAddress: string, rows: NotificationFeedEntry[]): void {
  if (typeof window === "undefined" || !userAddress) return;
  try {
    const trimmed = rows.slice(-MAX_ENTRIES);
    window.localStorage.setItem(key(userAddress), JSON.stringify(trimmed));
    window.dispatchEvent(new Event("clear:notification-feed-changed"));
  } catch {
    /* quota / private-mode - silently drop */
  }
}

function isEntry(x: unknown): x is NotificationFeedEntry {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.id === "string" &&
    (o.kind === "pending_approval" ||
      o.kind === "wallet_request" ||
      o.kind === "membership_change") &&
    typeof o.walletName === "string" &&
    typeof o.title === "string" &&
    typeof o.body === "string" &&
    typeof o.createdAt === "number"
  );
}

export function listNotificationFeed(userAddress: string): NotificationFeedEntry[] {
  return [...loadAll(userAddress)].sort((a, b) => b.createdAt - a.createdAt);
}

export function recordNotificationFeed(
  userAddress: string,
  entry: Omit<NotificationFeedEntry, "id" | "createdAt" | "seenAt"> & {
    createdAt?: number;
  },
): NotificationFeedEntry | null {
  if (typeof window === "undefined" || !userAddress) return null;
  const full: NotificationFeedEntry = {
    ...entry,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    createdAt: entry.createdAt ?? Date.now(),
  };
  const all = loadAll(userAddress);
  if (all.some((e) => e.id === full.id)) return full;
  all.push(full);
  persist(userAddress, all);
  return full;
}

export function markNotificationSeen(
  userAddress: string,
  id: string,
): NotificationFeedEntry | undefined {
  const all = loadAll(userAddress);
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) return undefined;
  if (all[idx].seenAt) return all[idx];
  all[idx] = { ...all[idx], seenAt: Date.now() };
  persist(userAddress, all);
  return all[idx];
}

export function markAllNotificationSeen(userAddress: string): void {
  const all = loadAll(userAddress);
  let changed = false;
  const next = all.map((entry) => {
    if (entry.seenAt) return entry;
    changed = true;
    return { ...entry, seenAt: Date.now() };
  });
  if (changed) persist(userAddress, next);
}

export function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("clear:notification-feed-changed", handler);
  const onStorage = () => cb();
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("clear:notification-feed-changed", handler);
    window.removeEventListener("storage", onStorage);
  };
}
