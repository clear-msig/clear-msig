"use client";

// Notification detail view. Marks the notification as seen on load.

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { Bell, ExternalLink, Landmark, ShieldCheck, UserPlus } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useNotificationFeed } from "@/lib/hooks/useNotificationFeed";
import { toDisplayName } from "@/lib/retail/walletNames";
import { relativeTime } from "@/lib/util/relativeTime";
import { Button } from "@/components/retail/Button";

export default function NotificationDetailPage() {
  const reduce = useReducedMotion();
  const params = useParams<{ id: string }>();
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const { rows, loading, error, markSeen } = useNotificationFeed(address);

  const id = params?.id ?? "";
  const entry = useMemo(() => rows.find((row) => row.id === id), [rows, id]);

  useEffect(() => {
    if (entry && !entry.seenAt) {
      markSeen(entry.id);
    }
  }, [entry, markSeen]);

  if (loading || error || !entry) {
    return (
      <div className="flex flex-col gap-4">
        <Link
          href="/app/notifications"
          className="inline-flex items-center gap-2 text-xs text-text-soft hover:text-text-strong"
        >
          {/* <ArrowLeft className="h-4 w-4" aria-hidden="true" /> */}
          Back to notifications
        </Link>
        <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
          <p className="text-sm font-medium text-text-strong">
            {loading
              ? "Loading notification"
              : error
                ? "Notification unavailable"
                : "Notification not found"}
          </p>
          <p className="mt-1 text-xs text-text-soft">
            {loading
              ? "Syncing the latest server state."
              : error ?? "This item may be older than the retained notification history."}
          </p>
        </div>
      </div>
    );
  }

  const walletLabel = toDisplayName(entry.walletName) || entry.walletName;
  const meta = iconMeta(entry.kind);
  const Icon = meta.Icon;

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
        <div className="flex items-start gap-3">
          <span className={clsx("flex h-10 w-10 items-center justify-center rounded-full", meta.accent)}>
            <Icon className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-semibold text-text-strong">
              {entry.title}
            </h1>
            <p className="mt-2 text-sm text-text-soft">{entry.body}</p>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-soft">
              <span>{walletLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(entry.createdAt)}</span>
            </div>
          </div>
        </div>

        {entry.href && (
          <div className="mt-5 flex flex-wrap gap-2">
            <Link href={entry.href}>
              <Button variant="primary" size="sm">
                {entry.kind === "money_movement" ? "Open wallet" : "Open request"}
                <ExternalLink className="h-4 w-4" aria-hidden="true" />
              </Button>
            </Link>
          </div>
        )}
      </section>
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
