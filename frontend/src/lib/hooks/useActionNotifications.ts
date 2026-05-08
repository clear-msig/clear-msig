"use client";

// Browser-notification glue for the multisig "something needs you"
// signal. Watches useActionNeeded and fires a Notification each time
// a new pending row appears that the user hasn't already seen on
// this device. Only fires when the tab is hidden — there's no point
// pinging a user who's already on the page.
//
// Why this matters in a multisig: collaborators land proposals at
// human pace and from a different device than yours. Without a push,
// you'd have to refresh the dashboard to find out you're blocking
// a send. This closes that loop without a server-side push pipeline.
//
// Persistence: the seen-set lives in localStorage keyed per-user so
// reloads / navigations don't re-fire. The set is bounded — only
// proposals seen in the most recent N pending snapshots are kept,
// so it doesn't grow unboundedly.

import { useCallback, useEffect, useRef, useState } from "react";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { useWallet } from "@/lib/wallet";
import { friendlyIntentLabel } from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  EMAIL_THROTTLE_MS,
  fireNotificationEmail,
  loadEmailPrefs,
  saveEmailPrefs,
} from "@/lib/security/emailNotifications";
import {
  fireWebhook,
  loadWebhookPrefs,
  shouldFireWebhook,
} from "@/lib/security/webhookNotifications";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

const STORAGE_PREFIX = "clear.notif-seen.v1.";
const MAX_SEEN = 200;

function storageKey(userAddress: string): string {
  return STORAGE_PREFIX + userAddress;
}

function loadSeen(userAddress: string): Set<string> {
  if (typeof window === "undefined" || !userAddress) return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(userAddress));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

function persistSeen(userAddress: string, seen: Set<string>): void {
  if (typeof window === "undefined" || !userAddress) return;
  try {
    // Cap at MAX_SEEN by keeping the most-recent insertions. We
    // don't track insertion time per entry, so trimming uses Set's
    // insertion-order iterator (newest at the end of an Array
    // copy).
    const arr = Array.from(seen);
    const trimmed = arr.slice(-MAX_SEEN);
    window.localStorage.setItem(
      storageKey(userAddress),
      JSON.stringify(trimmed),
    );
  } catch {
    /* localStorage full or blocked — silently noop */
  }
}

function detectPermission(): PermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return window.Notification.permission as PermissionState;
}

export interface UseActionNotificationsResult {
  /// Snapshot of the Notification API permission state. "unsupported"
  /// for browsers that don't have the API at all (e.g. iOS Safari
  /// outside PWA context).
  permission: PermissionState;
  /// True when the API exists. The "Enable" button is gated on this
  /// + permission === "default".
  supported: boolean;
  /// Triggers the browser permission prompt. Returns the resolved
  /// state. Calling when permission is already granted/denied is a
  /// no-op.
  request: () => Promise<PermissionState>;
  /// Most recent firing time (ms epoch), null if none. Lets the UI
  /// render a "we just notified you" affordance if needed.
  lastFiredAt: number | null;
}

export function useActionNotifications(): UseActionNotificationsResult {
  const { rows } = useActionNeeded();
  const wallet = useWallet();
  const userAddress = wallet.publicKey?.toBase58() ?? "";

  const [permission, setPermission] = useState<PermissionState>(() =>
    detectPermission(),
  );
  const [lastFiredAt, setLastFiredAt] = useState<number | null>(null);

  const seenRef = useRef<Set<string>>(new Set());
  const hydratedRef = useRef(false);

  // Hydrate the seen set on first user load. Re-hydrates when the
  // connected wallet changes — different identities, different
  // pending lists.
  useEffect(() => {
    seenRef.current = loadSeen(userAddress);
    hydratedRef.current = true;
  }, [userAddress]);

  // Keep the permission state fresh when the user changes it from
  // browser settings without a reload — Chrome fires no event for
  // permission changes, but useEffect re-running on dependency
  // changes covers most of it.
  useEffect(() => {
    setPermission(detectPermission());
  }, [rows.length]);

  // Fire on new pending rows. We compare against the seen set, mark
  // each fired row as seen, persist, then bail. Tab visibility
  // gates the actual Notification dispatch — when the tab is
  // foreground, the user already sees the in-page badge.
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (!userAddress) return;
    if (!("Notification" in window)) return;

    const seen = seenRef.current;
    const fresh: typeof rows = [];
    for (const r of rows) {
      if (!seen.has(r.proposalPda)) {
        fresh.push(r);
      }
    }
    if (fresh.length === 0) return;
    for (const r of fresh) seen.add(r.proposalPda);
    persistSeen(userAddress, seen);

    if (window.Notification.permission !== "granted") return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      // User's already on the page — no point pinging them. We
      // still flipped the seen flag so we don't ping later if they
      // background the tab and the row sticks around.
      return;
    }

    // Cap how many we fire at once. A flurry of N proposals all at
    // once shouldn't spam — show the first 3 and let the badge
    // handle the rest.
    const FIRE_CAP = 3;
    const fired = fresh.slice(0, FIRE_CAP);
    for (const r of fired) {
      try {
        const wallet = toDisplayName(r.walletName) || r.walletName;
        const action = friendlyIntentLabel(r.intentTemplate);
        const n = new window.Notification(
          `${wallet} needs your approval`,
          {
            body: `${action} · ${r.approvalsCollected}/${r.approverCount} approved`,
            icon: "/icon",
            tag: r.proposalPda, // dedupe per proposal across browsers
          },
        );
        n.onclick = () => {
          try {
            window.focus();
            window.location.assign(
              `/app/proposals/${encodeURIComponent(r.proposalPda)}`,
            );
          } finally {
            n.close();
          }
        };
      } catch {
        /* notification blocked / quota / browser quirk — ignore */
      }
    }
    setLastFiredAt(Date.now());

    // Also fire an email for the first new pending row when the
    // user has opted in. Throttled so a burst of N proposals doesn't
    // produce N inbox pings — first one wins, the badge handles the
    // rest.
    void maybeFireEmail(fired[0]);

    // Webhooks fire one event per fresh row (not throttled to one
    // like email) — ops tooling wants the full feed, not a sample.
    // Caller of fireWebhook still respects per-event-type opt-in
    // and walletScope.
    for (const r of fired) {
      void maybeFirePendingWebhook(r);
    }
  }, [rows, userAddress]);

  const request = useCallback(async (): Promise<PermissionState> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return "unsupported";
    }
    if (window.Notification.permission !== "default") {
      return window.Notification.permission as PermissionState;
    }
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result as PermissionState);
      return result as PermissionState;
    } catch {
      return detectPermission();
    }
  }, []);

  return {
    permission,
    supported: permission !== "unsupported",
    request,
    lastFiredAt,
  };
}

// Best-effort email send for the first row in a fresh pending
// batch. Re-reads the prefs at fire time (not at hook mount) so a
// user who toggles the setting in another tab gets the new
// behavior without a reload. Throttle is applied here, not in the
// hook body, so a re-render that happens to re-evaluate the effect
// can't sneak past the cap.
async function maybeFireEmail(
  row:
    | {
        walletName: string;
        intentTemplate: string;
        approvalsCollected: number;
        approverCount: number;
        proposalPda: string;
      }
    | undefined,
): Promise<void> {
  if (!row) return;
  const prefs = loadEmailPrefs();
  if (!prefs.enabled) return;
  if (!prefs.email) return;
  if (
    prefs.walletScope.length > 0 &&
    !prefs.walletScope.includes(row.walletName)
  ) {
    return;
  }
  const now = Date.now();
  if (
    typeof prefs.lastSentAt === "number" &&
    now - prefs.lastSentAt < EMAIL_THROTTLE_MS
  ) {
    return;
  }

  // Pass the bare proposal PDA — the API rebuilds the URL from
  // its own origin so an XSS that calls fireNotificationEmail
  // with an attacker-chosen URL can't turn the SMTP path into a
  // branded phishing relay.
  const result = await fireNotificationEmail({
    email: prefs.email,
    walletName: toDisplayName(row.walletName) || row.walletName,
    intentLabel: friendlyIntentLabel(row.intentTemplate),
    approvalsCollected: row.approvalsCollected,
    approverCount: row.approverCount,
    proposalPda: row.proposalPda,
  });
  if (result !== null) {
    saveEmailPrefs({ ...prefs, lastSentAt: result });
  }
}

// Pending-approval webhook fan-out. Returns immediately when the
// user hasn't opted in to this event type; otherwise posts a JSON
// payload directly to the configured destination.
async function maybeFirePendingWebhook(row: {
  walletName: string;
  intentTemplate: string;
  approvalsCollected: number;
  approverCount: number;
  proposalPda: string;
}): Promise<void> {
  const prefs = loadWebhookPrefs();
  if (!shouldFireWebhook(prefs, "pending_approval", row.walletName)) return;
  const proposalUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/app/proposals/${encodeURIComponent(row.proposalPda)}`
      : `/app/proposals/${encodeURIComponent(row.proposalPda)}`;
  await fireWebhook({
    event: "pending_approval",
    timestamp_ms: Date.now(),
    wallet_name: toDisplayName(row.walletName) || row.walletName,
    intent_label: friendlyIntentLabel(row.intentTemplate),
    approvals_collected: row.approvalsCollected,
    approver_count: row.approverCount,
    proposal_url: proposalUrl,
  });
}
