"use client";

// Live-updating approval bitmap.
//
// Each approver from the intent gets a dot; `approval_bitmap` bit N lit
// means approver N has signed. `cancellation_bitmap` shows with an
// amber ring. The component is purely presentational . parents pass
// the latest bitmaps (sourced from the `useProposalSubscription`
// Tanstack cache), and framer-motion animates each dot as it flips.

import { motion } from "framer-motion";
import { CheckCircle2, CircleSlash } from "lucide-react";
import { useMemo } from "react";

interface Props {
  approvers: string[];
  approvalBitmap: number;
  cancellationBitmap: number;
  threshold: number;
  proposer?: string;
}

export function ApprovalBitmap({
  approvers,
  approvalBitmap,
  cancellationBitmap,
  threshold,
  proposer,
}: Props) {
  const rows = useMemo(
    () =>
      approvers.map((addr, i) => ({
        addr,
        approved: (approvalBitmap & (1 << i)) !== 0,
        cancelled: (cancellationBitmap & (1 << i)) !== 0,
      })),
    [approvers, approvalBitmap, cancellationBitmap]
  );

  const approvalsMet = popcount(approvalBitmap) >= threshold;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-text-muted">
        <span>Approvals</span>
        <span
          className={
            approvalsMet
              ? "rounded-full bg-brand-green/20 px-2 py-0.5 text-brand-green"
              : "rounded-full bg-white/5 px-2 py-0.5 text-white/70"
          }
        >
          {popcount(approvalBitmap)} / {threshold}
        </span>
      </div>

      <ul className="flex flex-col gap-2">
        {rows.map((row, i) => {
          const isProposer = proposer && addrMatches(row.addr, proposer);
          return (
            <li
              key={row.addr + i}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2"
            >
              <StatusDot
                approved={row.approved}
                cancelled={row.cancelled}
                index={i}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate font-mono text-xs text-white/85">
                  {short(row.addr)}
                </span>
                {isProposer && (
                  <span className="text-[10px] uppercase tracking-wide text-brand-green">
                    proposer
                  </span>
                )}
              </div>
              {row.cancelled ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-400">
                  <CircleSlash size={10} /> cancel
                </span>
              ) : row.approved ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-brand-green/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-green">
                  <CheckCircle2 size={10} /> signed
                </span>
              ) : (
                <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/40">
                  pending
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function StatusDot({
  approved,
  cancelled,
  index,
}: {
  approved: boolean;
  cancelled: boolean;
  index: number;
}) {
  const color = cancelled
    ? "bg-amber-400"
    : approved
    ? "bg-brand-green"
    : "bg-white/20";
  return (
    <motion.span
      layout
      initial={false}
      animate={{
        scale: approved || cancelled ? 1.1 : 1,
      }}
      transition={{ type: "spring", stiffness: 340, damping: 24 }}
      className={`relative flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${color}`}
      aria-label={`approver ${index + 1} ${
        cancelled ? "cancelled" : approved ? "signed" : "pending"
      }`}
    >
      {(approved || cancelled) && (
        <motion.span
          initial={{ opacity: 0.6, scale: 1 }}
          animate={{ opacity: 0, scale: 2 }}
          transition={{ duration: 0.7, repeat: Infinity, repeatDelay: 1.5 }}
          className={`absolute inset-0 rounded-full ${color}`}
        />
      )}
      <span className="relative text-[10px] font-bold text-black">
        {index + 1}
      </span>
    </motion.span>
  );
}

function popcount(n: number): number {
  let v = n >>> 0;
  let c = 0;
  while (v) {
    c += v & 1;
    v >>>= 1;
  }
  return c;
}

function short(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function addrMatches(a: string, b: string): boolean {
  return a === b;
}
