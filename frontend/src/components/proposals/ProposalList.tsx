"use client";

// Compact list of every proposal under a wallet.
//
// Drives the deep-link flow: each row links to
// `/app/proposals/<pda>` . the full detail page with live bitmap,
// approve / cancel / execute buttons, and the signable preview.
//
// Reads direct from chain via `useProposalWorkflow`; intents are
// fetched separately so we can render each proposal's action string.

import Link from "next/link";
import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CheckCircle2,
  Clock,
  Inbox,
  ShieldAlert,
  X,
} from "lucide-react";
import { CardShell } from "@/components/ui/CardShell";
import { EmptyState } from "@/components/ui/EmptyState";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { useIntentWorkflow } from "@/lib/hooks/useIntentWorkflow";
import { useProposalWorkflow } from "@/lib/hooks/useProposalWorkflow";
import {
  ProposalStatus,
  renderTemplateToString,
  type IntentAccount,
  type ProposalAccount,
} from "@/lib/msig";

export function ProposalList({ walletName }: { walletName: string }) {
  const { listQuery } = useProposalWorkflow(walletName, "");
  const { listQuery: intentsQuery } = useIntentWorkflow(walletName);

  const intentByIndex = useMemo(() => {
    const map = new Map<number, IntentAccount>();
    for (const row of intentsQuery.data ?? []) {
      if (row.account) map.set(row.index, row.account);
    }
    return map;
  }, [intentsQuery.data]);

  const rows = useMemo(() => {
    const list = listQuery.data ?? [];
    return [...list].sort((a, b) =>
      a.proposalIndex < b.proposalIndex ? 1 : a.proposalIndex > b.proposalIndex ? -1 : 0
    );
  }, [listQuery.data]);

  return (
    <CardShell title="Recent proposals" subtitle="Live from Solana · click to open the signing view">
      <div className="flex flex-col gap-4">
        <AnimatePresence initial={false}>
          {listQuery.isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-col gap-2"
            >
              <SkeletonCard tone="dark" />
              <SkeletonCard tone="dark" />
            </motion.div>
          ) : rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              tone="dark"
              title="No proposals yet"
              description={`Your multisig "${walletName}" hasn't proposed a transaction yet.`}
              action={{ label: "Browse intents", href: "/app/intents" }}
            />
          ) : (
            <motion.ul
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-2"
            >
              {rows.map((r) => (
                <ProposalRow
                  key={r.pda.toBase58()}
                  pda={r.pda.toBase58()}
                  proposal={r.account}
                  intent={intentByIndex.get(r.intentIndex) ?? null}
                />
              ))}
            </motion.ul>
          )}
        </AnimatePresence>
      </div>
    </CardShell>
  );
}

function ProposalRow({
  pda,
  proposal,
  intent,
}: {
  pda: string;
  proposal: ProposalAccount;
  intent: IntentAccount | null;
}) {
  const chip = statusChip(proposal.status);
  const rendered = useMemo(() => {
    if (!intent) return "(intent loading…)";
    try {
      return renderTemplateToString(
        { params: intent.params, bytePool: intent.bytePool, template: intent.template },
        proposal.paramsData
      );
    } catch {
      return "(decode error)";
    }
  }, [intent, proposal.paramsData]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="group"
    >
      <Link
        href={`/app/proposals/${encodeURIComponent(pda)}`}
        className="flex items-start gap-3 rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition-all hover:border-brand-green/30 hover:bg-white/[0.04]"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/5 text-xs font-bold text-brand-green">
          #{proposal.proposalIndex.toString(10)}
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${chip.pillClass}`}
            >
              <chip.Icon size={10} />
              {chip.label}
            </span>
            <span className="font-mono text-[10px] text-white/40">{shortPda(pda)}</span>
          </div>
          <p className="truncate font-mono text-xs text-white/80">{rendered}</p>
        </div>
        <ArrowRight
          size={16}
          className="mt-1.5 shrink-0 text-white/30 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-green"
        />
      </Link>
    </motion.li>
  );
}

function statusChip(status: ProposalStatus): {
  label: string;
  Icon: typeof Check;
  pillClass: string;
} {
  switch (status) {
    case ProposalStatus.Active:
      return {
        label: "Active",
        Icon: Clock,
        pillClass: "border-amber-400/30 bg-amber-400/15 text-amber-300",
      };
    case ProposalStatus.Approved:
      return {
        label: "Approved",
        Icon: BadgeCheck,
        pillClass: "border-brand-green/30 bg-brand-green/15 text-brand-green",
      };
    case ProposalStatus.Executed:
      return {
        label: "Executed",
        Icon: CheckCircle2,
        pillClass: "border-sky-400/30 bg-sky-400/15 text-sky-300",
      };
    case ProposalStatus.Cancelled:
      return {
        label: "Cancelled",
        Icon: X,
        pillClass: "border-rose-400/30 bg-rose-400/15 text-rose-300",
      };
    default:
      return {
        label: "Unknown",
        Icon: ShieldAlert,
        pillClass: "border-white/10 bg-white/5 text-white/50",
      };
  }
}

function shortPda(s: string): string {
  if (!s) return "·";
  if (s.length <= 14) return s;
  return `${s.slice(0, 6)}…${s.slice(-6)}`;
}
