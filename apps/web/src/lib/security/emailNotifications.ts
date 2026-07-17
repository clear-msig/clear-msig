"use client";

// Email-on-pending preference + sender. Piggybacks on the same
// SMTP infra wired for invitations (/api/invitations) - adds a
// /api/notify-pending route that the browser POSTs to from the
// useActionNotifications hook when a new pending approval lands
// and the tab is in the background.
//
// What this is NOT today:
//   - A backend cron that watches chain state for users who don't
//     have the tab open. Real always-on email needs a server-side
//     watcher; this fires from the user's own browser, so it only
//     hits when they have the app loaded somewhere.
//   - Cross-device. Each browser persists its own preference;
//     opting in on a phone doesn't email the same user when their
//     desktop sees the row.
//
// Storage: per-device localStorage. Email never leaves the
// browser without an explicit opt-in click + a verification step
// (a confirmation email fires once on save and the user must reply
// or click the link - not implemented yet, see TODO at the bottom).

const STORAGE_KEY = "clear.email-notifications.v1";

export interface EmailNotificationPrefs {
  enabled: boolean;
  /// User-set destination email. Empty when not configured.
  email: string;
  /// Subset of wallet names to scope notifications to. Empty
  /// array means "every wallet I'm in" (the default).
  walletScope: string[];
  /// Unix ms of last successful send - used to throttle (no more
  /// than one email per minute regardless of rule volume).
  lastSentAt?: number;
}

export const EMAIL_THROTTLE_MS = 60 * 1000;

export function loadEmailPrefs(): EmailNotificationPrefs {
  const empty: EmailNotificationPrefs = {
    enabled: false,
    email: "",
    walletScope: [],
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.enabled === "boolean" &&
      typeof parsed.email === "string" &&
      Array.isArray(parsed.walletScope)
    ) {
      return {
        enabled: parsed.enabled,
        email: parsed.email,
        walletScope: parsed.walletScope.filter(
          (s: unknown): s is string => typeof s === "string",
        ),
        lastSentAt:
          typeof parsed.lastSentAt === "number" ? parsed.lastSentAt : undefined,
      };
    }
    return empty;
  } catch {
    return empty;
  }
}

export function saveEmailPrefs(prefs: EmailNotificationPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private-mode - silently noop */
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmailAddress(s: string): boolean {
  return EMAIL_RE.test(s.trim());
}

interface FirePayload {
  email: string;
  walletName: string;
  /// Display label for the action (e.g. "Send 0.5 SOL").
  intentLabel: string;
  /// Approvals so far / approver count snapshot for context.
  approvalsCollected: number;
  approverCount: number;
  /// Base58 proposal PDA. The server builds the user-facing URL
  /// from this + its own origin - never trusts a body-supplied URL.
  /// Without that pin the route is a "branded Clear" phishing relay
  /// (attacker chooses the destination email AND the link).
  proposalPda: string;
}

/// Fire one notification email. Called by useActionNotifications
/// when a new pending row is seen + the tab is hidden + the user
/// has opted in. Returns the new lastSentAt on success or null on
/// failure (rate-limited / network / SMTP). Never throws.
export async function fireNotificationEmail(
  payload: FirePayload,
): Promise<number | null> {
  const now = Date.now();
  try {
    const res = await fetch("/api/notify-pending", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return null;
    return now;
  } catch {
    return null;
  }
}

// TODO: verification step. Today an opt-in saves the email
// directly. A real flow would send a confirmation message with a
// click-through link, store a "verified=true" flag, and refuse to
// send to unverified addresses. The /api/invitations endpoint
// already has the SMTP plumbing; verifying is one new endpoint +
// a flag on the prefs. Unblocked when we have somewhere stable to
// stash the verification token (today: localStorage works for the
// optimistic case, breaks when the user opens the link in a
// different browser).
