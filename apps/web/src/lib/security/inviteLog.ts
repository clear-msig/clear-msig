"use client";

// Per-device log of invite emails this browser has sent on the
// user's behalf. Two reasons it lives client-side:
//
//   1. We don't run a backend that keeps per-user state. The email
//      send is one-shot through /api/invitations and the SMTP
//      provider doesn't expose history we can query back.
//   2. The audit trail is most useful to the person doing the
//      inviting - "did I already email Alice? when?" - and that
//      person is in this browser. A second device of the same user
//      gets a fresh log; that's a known limitation of the device-
//      local model.
//
// Status transitions:
//   sent     - the /api/invitations call returned 2xx.
//   revoked  - user clicked "Withdraw" in /app/invitations and the
//              follow-up email shipped (success). Distinct from
//              "removed on chain" - the membership PDA might still
//              be active; this just notifies the invitee that the
//              invite was withdrawn before they got around to acting.

const STORAGE_KEY = "clear.invite-log.v1";
const MAX_ENTRIES = 200;

export type InviteStatus = "sent" | "revoked";

export interface InviteLogEntry {
  id: string;
  walletName: string;
  inviteeName: string;
  inviteeAddress: string;
  inviteeEmail: string;
  inviterAddress: string;
  /// Member role at the time of invite. Mirrors lib/retail/roles
  /// so this stays in sync with the rest of the codebase. "full"
  /// = proposer + approver, the default for human members; the
  /// other two are restricted variants.
  role: "full" | "approver" | "watcher";
  status: InviteStatus;
  sentAt: number;
  revokedAt?: number;
}

function readAll(): InviteLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isInviteEntry);
  } catch {
    return [];
  }
}

function writeAll(rows: InviteLogEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = rows.slice(-MAX_ENTRIES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    window.dispatchEvent(new Event("clear:invite-log-changed"));
  } catch {
    /* quota / private mode - silently drop */
  }
}

function isInviteEntry(x: unknown): x is InviteLogEntry {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    typeof r.walletName === "string" &&
    typeof r.inviteeName === "string" &&
    typeof r.inviteeAddress === "string" &&
    typeof r.inviteeEmail === "string" &&
    typeof r.inviterAddress === "string" &&
    typeof r.role === "string" &&
    (r.status === "sent" || r.status === "revoked") &&
    typeof r.sentAt === "number"
  );
}

export function recordInvite(
  entry: Omit<InviteLogEntry, "id" | "status" | "sentAt">,
): InviteLogEntry {
  const full: InviteLogEntry = {
    ...entry,
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2),
    status: "sent",
    sentAt: Date.now(),
  };
  const all = readAll();
  all.push(full);
  writeAll(all);
  return full;
}

export function listInvites(): InviteLogEntry[] {
  const all = readAll();
  // Newest first.
  return [...all].sort((a, b) => b.sentAt - a.sentAt);
}

export function findInvite(id: string): InviteLogEntry | undefined {
  return readAll().find((e) => e.id === id);
}

/// Mark a sent invite as revoked. No-op when already revoked or
/// when the id is unknown. Caller is responsible for actually
/// firing the revocation email (we don't want this function to
/// have a side effect on email).
export function markRevoked(id: string): InviteLogEntry | undefined {
  const all = readAll();
  const idx = all.findIndex((e) => e.id === id);
  if (idx < 0) return undefined;
  if (all[idx].status === "revoked") return all[idx];
  const updated: InviteLogEntry = {
    ...all[idx],
    status: "revoked",
    revokedAt: Date.now(),
  };
  all[idx] = updated;
  writeAll(all);
  return updated;
}

export function subscribe(cb: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => cb();
  window.addEventListener("clear:invite-log-changed", handler);
  // Cross-tab updates fire `storage`, not our custom event.
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener("clear:invite-log-changed", handler);
    window.removeEventListener("storage", onStorage);
  };
}
