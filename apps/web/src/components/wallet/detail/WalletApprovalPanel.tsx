"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Bell } from "lucide-react";
import type { ActionNeededRow } from "@/lib/hooks/useActionNeeded";
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
  const wallet = useWallet();
  const viewerAddress = wallet.publicKey?.toBase58() ?? "";
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
          <span className="font-mono text-xs uppercase tracking-[0.12em] text-accent">
            Needs your approval
          </span>
          <span className="font-numerals text-xs font-semibold tabular-nums text-text-strong">
            {rows.length}
          </span>
        </span>
      </header>

      <div className="px-5 py-4">
        <p className="text-sm text-text-soft">
          Open each request to review its verified action details before
          approving.
        </p>

        <ul className="mt-3 flex flex-col divide-y divide-border-soft">
          {rows.map((row) => {
            const label = row.intentPending
              ? "New request · details loading"
              : friendlyIntentLabel(row.intentTemplate);
            const who = proposerDisplayName(row.proposer, viewerAddress);
            const ago = relativeTime(row.proposedAt);
            const tally =
              row.approvalThreshold && row.approvalThreshold > 0
                ? `${row.approvalsCollected} of ${row.approvalThreshold} required approvals`
                : `${row.approvalsCollected} approvals · threshold loading`;
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
                    <p className="text-base font-medium text-text-strong">
                      {label}
                    </p>
                    <p className="mt-1 text-xs text-text-soft">
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
