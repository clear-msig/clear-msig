"use client";

// Notifications inbox - local device feed for multisig events.
// Uses the same Obsidian & Lime card styling as Activity and Wallet.

import { useMemo } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, Bell, BellOff, Landmark, ShieldCheck, UserPlus } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useNotificationFeed } from "@/lib/hooks/useNotificationFeed";
import { toDisplayName } from "@/lib/retail/walletNames";
import { relativeTime } from "@/lib/util/relativeTime";
import { Button } from "@/components/retail/Button";

export default function NotificationsPage() {
  const reduce = useReducedMotion();
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const { rows, unreadCount, markAllSeen } = useNotificationFeed(address);

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
      };

  const summary = useMemo(() => {
    if (rows.length === 0) return "No notifications yet.";
    if (unreadCount === 0) return `${rows.length} notification${rows.length === 1 ? "" : "s"} · all caught up`;
    return `${rows.length} notification${rows.length === 1 ? "" : "s"} · ${unreadCount} unread`;
  }, [rows.length, unreadCount]);

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <Link
        href="/app/wallet"
        className="inline-flex w-fit items-center gap-2 text-xs font-medium text-text-soft transition-colors duration-base hover:text-text-strong md:hidden"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Back
      </Link>

      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-2">
          <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
            Notifications
          </h1>
          <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
        </div>
        {unreadCount > 0 && (
          <Button variant="secondary" size="sm" onClick={markAllSeen}>
            Mark all read
          </Button>
        )}
      </header>

      {rows.length === 0 ? (
        <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-glass-soft text-text-soft">
              <BellOff className="h-5 w-5" strokeWidth={1.6} />
            </span>
            <div>
              <p className="text-sm font-medium text-text-strong">You are all caught up</p>
              <p className="mt-1 text-xs text-text-soft">
                New approval requests and wallet updates will land here.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
          <ul className="flex flex-col divide-y divide-border-soft">
            {rows.map((row) => {
              const walletLabel = toDisplayName(row.walletName) || row.walletName;
              const seen = !!row.seenAt;
              const meta = iconMeta(row.kind);
              const Icon = meta.Icon;
              return (
                <li key={row.id}>
                  <Link
                    href={`/app/notifications/${encodeURIComponent(row.id)}`}
                    className={
                      "group flex items-start gap-3 py-3 transition-colors duration-base ease-out-soft " +
                      "hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 " +
                      "focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                    }
                  >
                    <span
                      className={clsx(
                        "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                        seen
                          ? "bg-glass-soft text-text-soft"
                          : meta.accent,
                      )}
                    >
                      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-strong">
                        {row.title}
                      </p>
                      <p className="mt-0.5 text-xs text-text-soft">
                        {row.body}
                      </p>
                      <p className="mt-1 text-[11px] text-text-soft">
                        {walletLabel} · {relativeTime(row.createdAt)}
                      </p>
                    </div>
                    {!seen && (
                      <span
                        className={
                          "mt-1 rounded-full bg-accent px-2 py-0.5 text-[10px] " +
                          "font-semibold uppercase tracking-[0.16em] text-text-on-accent"
                        }
                      >
                        New
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </motion.div>
  );
}

const iconMeta = (kind: string) => {
  switch (kind) {
    case "pending_approval":
      return { Icon: ShieldCheck, accent: "bg-accent/10 text-accent" };
    case "wallet_request":
      return { Icon: Bell, accent: "bg-accent/10 text-accent" };
    case "membership_change":
      return { Icon: UserPlus, accent: "bg-emerald-500/10 text-emerald-400" };
    case "money_movement":
      return { Icon: Landmark, accent: "bg-accent/10 text-accent" };
    default:
      return { Icon: Bell, accent: "bg-accent/10 text-accent" };
  }
};
