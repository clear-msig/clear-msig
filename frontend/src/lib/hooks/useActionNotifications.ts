"use client";

// Turns on-chain approval and membership snapshots into stable server
// notification events. The server owns deduplication and read state;
// this hook only handles browser, email, and webhook delivery for events
// the server confirms are newly inserted.

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { useWallet } from "@/lib/wallet";
import { friendlyIntentLabel } from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  describeRolesRights,
  describeRolesSummary,
} from "@/lib/retail/memberAccess";
import {
  EMAIL_THROTTLE_MS,
  fireNotificationEmail,
  loadEmailPrefs,
  saveEmailPrefs,
} from "@/lib/security/emailNotifications";
import {
  loadApprovalReminderPrefs,
  saveApprovalReminderPrefs,
  shouldSendApprovalReminder,
} from "@/lib/security/approvalReminders";
import {
  fireWebhook,
  loadWebhookPrefs,
  shouldFireWebhook,
} from "@/lib/security/webhookNotifications";
import { syncNotificationEvents } from "@/lib/notifications/client";
import { proposerDisplayName } from "@/lib/retail/proposerName";

type PermissionState = "default" | "granted" | "denied" | "unsupported";

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
  const { rows, activity } = useActionNeeded();
  const wallet = useWallet();
  const userAddress = wallet.publicKey?.toBase58() ?? "";
  const memberships = useQuery({
    queryKey: ["notification-memberships", userAddress],
    queryFn: () => fetchOnchainMemberships(userAddress),
    enabled: userAddress.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const [permission, setPermission] = useState<PermissionState>(() =>
    detectPermission(),
  );
  const [lastFiredAt, setLastFiredAt] = useState<number | null>(null);
  const membershipRows = memberships.data;

  useEffect(() => {
    if (!userAddress) return;
    const entries = activity.allRows.flatMap((row) => {
      if (row.status !== 0) return [];
      const who = proposerDisplayName(row.proposer, userAddress);
      return [{
        sourceId: `proposal:${row.proposalPda}:created`,
        kind: "wallet_request",
        walletName: row.walletName,
        title: `${toDisplayName(row.walletName) || row.walletName} has a new request`,
        body: `${friendlyIntentLabel(row.intentTemplate)} · started by ${who}`,
        href: `/app/proposals/${encodeURIComponent(row.proposalPda)}`,
        createdAt: Number(row.proposedAt) * 1_000,
      } as const];
    });
    void syncNotificationEvents(entries).catch(() => undefined);
  }, [activity.allRows, userAddress]);

  // Keep the permission state fresh when the user changes it from
  // browser settings without a reload - Chrome fires no event for
  // permission changes, but useEffect re-running on dependency
  // changes covers most of it.
  useEffect(() => {
    setPermission(detectPermission());
  }, [rows.length]);

  useEffect(() => {
    if (!userAddress || rows.length === 0) return;
    let cancelled = false;
    const sourceRows = new Map<string, (typeof rows)[number]>();
    const entries = rows.map((row) => {
      const sourceId = `proposal:${row.proposalPda}:approval-needed`;
      sourceRows.set(sourceId, row);
      const who = proposerDisplayName(row.proposer, userAddress);
      const action = friendlyIntentLabel(row.intentTemplate);
      const tally =
        row.approverCount > 0
          ? `${row.approvalsCollected}/${row.approverCount} approved`
          : "awaiting approval";
      return {
        sourceId,
        kind: "pending_approval" as const,
        walletName: row.walletName,
        title: `${toDisplayName(row.walletName) || row.walletName} needs your approval`,
        body: `${action} · started by ${who} · ${tally}`,
        href: `/app/proposals/${encodeURIComponent(row.proposalPda)}`,
        createdAt: Number(row.proposedAt) * 1_000,
      };
    });

    void syncNotificationEvents(entries).then((results) => {
      if (cancelled) return;
      const fired = results
        .filter((result) => result.inserted)
        .map((result) => sourceRows.get(result.entry.sourceId))
        .filter((row): row is (typeof rows)[number] => !!row)
        .slice(0, 3);
      if (fired.length === 0) return;

      void maybeFireEmail(fired[0]);
      for (const row of fired) void maybeFirePendingWebhook(row);

      if (!("Notification" in window)) return;
      if (window.Notification.permission !== "granted") return;
      if (document.visibilityState === "visible") return;

      for (const r of fired) {
        const who = proposerDisplayName(r.proposer, userAddress);
        const action = friendlyIntentLabel(r.intentTemplate);
        const tally =
          r.approverCount > 0
            ? `${r.approvalsCollected}/${r.approverCount} approved`
            : "awaiting approval";
        try {
          const wallet = toDisplayName(r.walletName) || r.walletName;
          const n = new window.Notification(`${wallet} needs your approval`, {
            body: `${action} · started by ${who} · ${tally}`,
            icon: "/icon",
            tag: r.proposalPda, // dedupe per proposal across browsers
          });
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
          /* notification blocked / quota / browser quirk - ignore */
        }
      }
      setLastFiredAt(Date.now());
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rows, userAddress]);

  useEffect(() => {
    if (!userAddress || rows.length === 0) return;
    let syncing = false;
    const interval = window.setInterval(() => {
      if (syncing) return;
      const prefs = loadApprovalReminderPrefs();
      if (!shouldSendApprovalReminder(prefs)) return;
      const first = rows[0];
      if (!first) return;
      const walletName = toDisplayName(first.walletName) || first.walletName;
      const title =
        rows.length === 1
          ? `${walletName} still needs your approval`
          : `${rows.length} approvals are waiting`;
      const body =
        rows.length === 1
          ? friendlyIntentLabel(first.intentTemplate)
          : "Open ClearSig to review what needs you.";
      const reminderAt = Date.now();
      syncing = true;
      void syncNotificationEvents([
        {
          sourceId: `approval-reminder:${first.proposalPda}:${Math.floor(reminderAt / prefs.intervalMs)}`,
          kind: "pending_approval",
          walletName: first.walletName,
          title,
          body,
          href: `/app/proposals/${encodeURIComponent(first.proposalPda)}`,
          createdAt: reminderAt,
        },
      ]).then((results) => {
        if (
          results[0]?.inserted &&
          "Notification" in window &&
          window.Notification.permission === "granted"
        ) {
          try {
            const n = new window.Notification(title, {
              body,
              icon: "/icon",
              tag: `clear-reminder-${first.proposalPda}`,
            });
            n.onclick = () => {
              try {
                window.focus();
                window.location.assign(
                  `/app/proposals/${encodeURIComponent(first.proposalPda)}`,
                );
              } finally {
                n.close();
              }
            };
          } catch {
            /* browser blocked the reminder */
          }
        }
        saveApprovalReminderPrefs({
          ...prefs,
          lastReminderAt: reminderAt,
        });
      }).catch(() => undefined).finally(() => {
        syncing = false;
      });
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [rows, userAddress]);

  useEffect(() => {
    if (!userAddress || !membershipRows) return;
    const sourceMemberships = new Map<
      string,
      NonNullable<typeof membershipRows>[number]
    >();
    const entries = membershipRows.map((membership) => {
      const roleLabel = membership.roles.slice().sort().join("|");
      const sourceId = `membership:${membership.wallet}:${roleLabel}`;
      sourceMemberships.set(sourceId, membership);
      const roleText = `${describeRolesSummary(membership.roles)}. ${describeRolesRights(membership.roles)}`;
      return {
        sourceId,
        kind: "membership_change",
        walletName: membership.wallet_name || membership.wallet,
        title: `${toDisplayName(membership.wallet_name || membership.wallet) || membership.wallet} updated your access`,
        body: roleText,
        href: `/app/wallet/${encodeURIComponent(membership.wallet_name || membership.wallet)}`,
      } as const;
    });
    void syncNotificationEvents(entries).then((results) => {
      if (!("Notification" in window) || window.Notification.permission !== "granted") return;
      for (const result of results) {
        if (!result.inserted) continue;
        const membership = sourceMemberships.get(result.entry.sourceId);
        if (!membership) continue;
        const roleText = `${describeRolesSummary(membership.roles)}. ${describeRolesRights(membership.roles)}`;
        try {
          const n = new window.Notification(
            `${toDisplayName(membership.wallet_name || membership.wallet) || membership.wallet} access updated`,
            {
              body: roleText,
              icon: "/icon",
              tag: result.entry.sourceId,
            },
          );
          setTimeout(() => n.close(), 4000);
        } catch {
          /* noop */
        }
      }
    }).catch(() => undefined);
  }, [membershipRows, userAddress]);

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

  // Pass the bare proposal PDA - the API rebuilds the URL from
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
