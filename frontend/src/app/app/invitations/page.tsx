"use client";

// Sent invitations — per-device audit log of email invites this
// browser dispatched. Each row shows the recipient + wallet, with
// a Withdraw button that fires the revocation email and flips the
// row's status. The on-chain membership is independent of this
// log; revoking the email here doesn't remove the member from the
// wallet (that's /members → Remove). The copy on the page calls
// that distinction out so users don't get false confidence.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Mail, MailX, Undo2 } from "lucide-react";
import {
  listInvites,
  markRevoked,
  subscribe,
  type InviteLogEntry,
} from "@/lib/security/inviteLog";
import { revokeOrganizationInvite } from "@/lib/organizations/client";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useToast } from "@/components/ui/Toast";

const ROLE_LABEL: Record<InviteLogEntry["role"], string> = {
  full: "approver",
  approver: "approver",
  watcher: "watcher",
};

function shortAddress(addr: string): string {
  if (addr.length <= 10) return addr;
  return `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

function formatTime(ms: number): string {
  const dt = new Date(ms);
  const now = Date.now();
  const diff = now - ms;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return "just now";
  if (diff < hour) return `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return `${Math.floor(diff / hour)}h ago`;
  if (diff < 7 * day) return `${Math.floor(diff / day)}d ago`;
  return dt.toLocaleDateString();
}

export default function InvitationsPage() {
  const reduce = useReducedMotion();
  const toast = useToast();
  const [rows, setRows] = useState<InviteLogEntry[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    setRows(listInvites());
    setHydrated(true);
    return subscribe(() => setRows(listInvites()));
  }, []);

  const sent = useMemo(() => rows.filter((r) => r.status === "sent"), [rows]);
  const revoked = useMemo(
    () => rows.filter((r) => r.status === "revoked"),
    [rows],
  );

  const handleWithdraw = async (entry: InviteLogEntry) => {
    if (busyId) return;
    setBusyId(entry.id);
    try {
      await revokeOrganizationInvite({
        walletName: entry.walletName,
        inviterAddress: entry.inviterAddress,
        invitee: {
          address: entry.inviteeAddress,
          email: entry.inviteeEmail,
        },
      });
      markRevoked(entry.id);
      toast.success(`Withdrawal email sent to ${entry.inviteeEmail}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Couldn't send withdrawal",
      );
    } finally {
      setBusyId(null);
    }
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 } };

  return (
    <div className="flex flex-col gap-6">
      <StickyTopBar offset="header">
        <Link
          href="/app/settings"
          className={
            "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Settings
        </Link>
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center text-center"
      >
        <span aria-hidden="true" className="block h-px w-10 bg-accent" />
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Invitations
        </p>
        <h1 className="mt-2 font-display text-display-xs leading-tight text-text-strong">
          Sent invitations
        </h1>
        <p className="mt-1 text-base text-text-soft">
          Email invites you&rsquo;ve sent from this browser. Withdraw an
          invite to email the recipient that it was a mistake.
        </p>
        <p className="mx-auto mt-2 max-w-md text-xs text-text-soft">
          Withdrawing the email <span className="font-medium text-text-strong">does not</span>{" "}
          remove the member from the wallet on-chain. Open the wallet&rsquo;s
          Members page to do that.
        </p>
      </motion.section>

      {!hydrated ? null : sent.length === 0 && revoked.length === 0 ? (
        <section className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest">
          <Mail
            className="mx-auto h-6 w-6 text-text-soft"
            strokeWidth={1.5}
            aria-hidden="true"
          />
          <p className="mt-3 text-sm text-text-strong">No invites yet</p>
          <p className="mt-1 text-xs text-text-soft">
            Invites you send from a wallet&rsquo;s Members page show up here.
          </p>
        </section>
      ) : (
        <>
          {sent.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Active ({sent.length})
              </h2>
              {sent.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
                >
                  <div className="flex items-center gap-3">
                    <MemberAvatar address={entry.inviteeAddress} size="md" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-strong">
                        {entry.inviteeName}{" "}
                        <span className="text-xs font-normal text-text-soft">
                          {ROLE_LABEL[entry.role]}
                        </span>
                      </p>
                      <p className="truncate text-xs text-text-soft">
                        {entry.inviteeEmail} · {shortAddress(entry.inviteeAddress)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-text-soft">
                        {toDisplayName(entry.walletName) || entry.walletName} ·
                        sent {formatTime(entry.sentAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleWithdraw(entry)}
                      disabled={busyId === entry.id}
                      className={
                        "shrink-0 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft " +
                        "transition-colors duration-base ease-out-soft hover:border-rose-500 hover:text-rose-600 " +
                        "disabled:cursor-not-allowed disabled:opacity-50 " +
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                      }
                    >
                      {busyId === entry.id ? "Sending…" : "Withdraw"}
                    </button>
                  </div>
                </article>
              ))}
            </section>
          )}

          {revoked.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                Withdrawn ({revoked.length})
              </h2>
              {revoked.map((entry) => (
                <article
                  key={entry.id}
                  className="rounded-card border border-border-soft bg-surface-raised p-4 opacity-70 shadow-card-rest"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-600">
                      <MailX className="h-5 w-5" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-strong line-through decoration-text-soft/60">
                        {entry.inviteeName}
                      </p>
                      <p className="truncate text-xs text-text-soft">
                        {entry.inviteeEmail} · {shortAddress(entry.inviteeAddress)}
                      </p>
                      <p className="mt-0.5 text-[11px] text-text-soft">
                        {toDisplayName(entry.walletName) || entry.walletName} ·
                        withdrawn{" "}
                        {entry.revokedAt ? formatTime(entry.revokedAt) : "—"}
                      </p>
                    </div>
                    <Undo2
                      className="h-4 w-4 shrink-0 text-text-soft"
                      aria-hidden="true"
                    />
                  </div>
                </article>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
