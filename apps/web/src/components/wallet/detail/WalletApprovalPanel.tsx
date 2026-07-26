"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Bell } from "lucide-react";
import { BadgePill } from "@/components/retail/BadgePill";
import type { ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import { useBatchApprove } from "@/lib/hooks/useBatchApprove";
import { friendlyIntentLabel } from "@/lib/retail/labels";
import { proposerDisplayName } from "@/lib/retail/proposerName";
import { relativeTime } from "@/lib/util/relativeTime";
import { useWallet } from "@/lib/wallet";

export interface WalletApprovalPanelProps {
  rows: ActionNeededRow[];
  reduce: boolean;
}

export function WalletApprovalPanel({
  rows,
  reduce,
}: WalletApprovalPanelProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const batch = useBatchApprove();
  const wallet = useWallet();
  const viewerAddress = wallet.publicKey?.toBase58() ?? "";
  const running =
    batch.progress !== null &&
    batch.progress.completed < batch.progress.total &&
    !batch.progress.error;
  const showApproveAll = rows.length >= 2;

  const handleApproveAll = () => {
    batch.approveAll(
      rows.map((r) => ({
        walletName: r.walletName,
        proposalPda: r.proposalPda,
        label: friendlyIntentLabel(r.intentTemplate),
      })),
    );
  };

  return (
    <motion.section
      id="action-needed"
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="overflow-hidden rounded-card border border-accent/40 bg-surface-raised shadow-card-rest scroll-mt-24"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/20 bg-accent/[0.04] px-5 py-3">
        <span className="inline-flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Bell className="h-3 w-3" strokeWidth={2.25} />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Needs your approval
          </span>
          <span className="font-numerals text-[11px] font-semibold tabular-nums text-text-strong">
            {rows.length}
          </span>
        </span>
        {showApproveAll && (
          <BadgePill onClick={handleApproveAll} disabled={running}>
            {running ? "Approving…" : "Approve all"}
          </BadgePill>
        )}
      </header>

      <div className="px-5 py-4">
        {batch.progress && (
          <BatchProgressRow progress={batch.progress} onDismiss={batch.reset} />
        )}
        {!batch.progress && rows.length > 0 && (
          <p className="text-[11px] text-text-soft">
            Approving fires one wallet popup per request. Tap Approve in each.
          </p>
        )}

        <ul className="mt-3 flex flex-col divide-y divide-border-soft">
          {rows.map((row) => {
            const label = row.intentPending
              ? "New request · details loading"
              : friendlyIntentLabel(row.intentTemplate);
            const who = proposerDisplayName(row.proposer, viewerAddress);
            const ago = relativeTime(row.proposedAt);
            const tally =
              row.approverCount > 0
                ? `${row.approvalsCollected} of ${row.approverCount} approved`
                : "awaiting approval";
            return (
              <li key={row.proposalPda}>
                <Link
                  href={`/app/proposals/${row.proposalPda}`}
                  className={
                    "group flex items-center justify-between gap-3 rounded-soft px-2 py-3 -mx-2 " +
                    "transition-colors duration-base ease-out-soft hover:bg-canvas " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-strong">
                      {label}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-text-soft">
                      by {who} · {ago} · {tally}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </motion.section>
  );
}

// ─── Inline batch-progress row (mirrors the dashboard) ─────────────

function BatchProgressRow({
  progress,
  onDismiss,
}: {
  progress: {
    total: number;
    completed: number;
    error?: string;
    currentLabel?: string;
  };
  onDismiss: () => void;
}) {
  const done = progress.completed >= progress.total;
  const stopped = !!progress.error;
  const pct = Math.round((progress.completed / progress.total) * 100);
  return (
    <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-text-strong">
          {stopped
            ? `Stopped. Approved ${progress.completed} of ${progress.total}`
            : done
              ? `Approved ${progress.total} request${progress.total === 1 ? "" : "s"}`
              : `Approving ${progress.completed + 1} of ${progress.total}…`}
        </span>
        {(done || stopped) && (
          <button
            type="button"
            onClick={onDismiss}
            className="text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
          >
            Dismiss
          </button>
        )}
      </div>
      {!done && !stopped && progress.currentLabel && (
        <p className="mt-1 truncate text-[11px] text-text-soft">
          {progress.currentLabel}
        </p>
      )}
      {stopped && progress.error && (
        <p className="mt-1 text-[11px] text-warning">{progress.error}</p>
      )}
      <div
        aria-hidden="true"
        className="mt-2 h-1 overflow-hidden rounded-full bg-border-soft"
      >
        <div
          className="h-full bg-accent transition-[width] duration-base ease-out-soft"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
