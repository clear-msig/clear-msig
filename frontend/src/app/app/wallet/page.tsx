"use client";

// Wallet hub — dashboard for connected users.
//
// Layout:
//   - Compact hero (welcome + connected pubkey).
//   - Stats row (orgs / active proposals / executed total / executed-this-week).
//   - Recent activity feed (top 5, richer than the sidebar's compact rows).
//   - Create wallet section (form + side panel).
//
// MyOrganizationsCard was retired here — the persistent sidebar is the
// canonical "your wallets" surface. Keeping both was visual duplication.

import Link from "next/link";
import { motion } from "framer-motion";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  ArrowRight,
  CheckCircle2,
  Clock,
  Network,
  Rocket,
  Sparkles,
  Wallet as WalletIcon,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CreateWalletCard } from "@/components/wallet/CreateWalletCard";
import { WalletPanel } from "@/components/wallet/WalletPanel";
import { WorkflowTips } from "@/components/layout/WorkflowTips";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { useUserStats } from "@/lib/hooks/useUserStats";
import { ProposalStatus } from "@/lib/msig";
import { Skeleton } from "@/components/ui/Skeleton";
import { relativeTime } from "@/lib/util/relativeTime";

export default function WalletPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHero />
      <StatsRow />
      <RecentActivityCard />

      <Section
        delay={0.25}
        eyebrow="Create"
        eyebrowIcon={<Sparkles size={11} />}
        title="Spin up a new organization"
        description="Bind it to the chains you want to drive, then invite your co-signers."
      >
        <div className="grid gap-6 xl:grid-cols-[1.15fr_1fr]">
          <CreateWalletCard />
          <WalletPanel />
        </div>
      </Section>

      <WorkflowTips />
    </div>
  );
}

function PageHero() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const short = address ? `${address.slice(0, 4)}…${address.slice(-4)}` : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl border border-black/10 bg-white/70 px-6 py-7 shadow-card-shadow backdrop-blur sm:px-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-12 -top-12 h-48 w-48 rounded-full bg-brand-green/15 blur-3xl"
      />
      <div className="relative z-10 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green/15 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-brand-emerald">
            <WalletIcon size={11} /> Workspace
          </span>
          {short && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 font-mono text-[11px] text-black/60">
              {short}
            </span>
          )}
        </div>
        <h1 className="font-display text-2xl font-bold leading-tight tracking-tight text-black text-balance sm:text-3xl">
          Your treasury, at a glance.
        </h1>
        <p className="max-w-xl text-sm text-black/60">
          Pending approvals, executed transactions, and live activity across
          every multisig you sign for.
        </p>
      </div>
    </motion.div>
  );
}

function StatsRow() {
  const stats = useUserStats();
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: 0.05 }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <StatCard
        label="Organisations"
        value={stats.walletCount}
        Icon={Network}
        loading={stats.loading}
        tone="cyan"
      />
      <StatCard
        label="Pending"
        value={stats.activeProposals}
        Icon={Clock}
        loading={stats.loading}
        tone="amber"
      />
      <StatCard
        label="Executed"
        value={stats.executedProposals}
        Icon={Rocket}
        loading={stats.loading}
        tone="green"
        sub={
          stats.executedThisWeek > 0
            ? `${stats.executedThisWeek} this week`
            : undefined
        }
      />
      <StatCard
        label="Total proposals"
        value={stats.totalProposals}
        Icon={Zap}
        loading={stats.loading}
        tone="brand"
      />
    </motion.div>
  );
}

function StatCard({
  label,
  value,
  Icon,
  loading,
  tone,
  sub,
}: {
  label: string;
  value: number;
  Icon: LucideIcon;
  loading: boolean;
  tone: "brand" | "cyan" | "amber" | "green";
  sub?: string;
}) {
  const toneAccent =
    tone === "cyan"
      ? "text-cyan-300 bg-cyan-300/10"
      : tone === "amber"
      ? "text-amber-300 bg-amber-300/10"
      : tone === "green"
      ? "text-brand-green bg-brand-green/15"
      : "text-brand-green bg-brand-green/15";
  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black p-4 shadow-card-dark">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
            {label}
          </span>
          {loading ? (
            <Skeleton tone="dark" className="mt-1 h-7 w-12 rounded" />
          ) : (
            <span className="font-display text-2xl font-bold text-white">
              {value}
            </span>
          )}
          {sub && (
            <span className="text-[10px] text-white/40">{sub}</span>
          )}
        </div>
        <div className={`flex h-8 w-8 items-center justify-center rounded-xl ${toneAccent}`}>
          <Icon size={14} />
        </div>
      </div>
    </div>
  );
}

function RecentActivityCard() {
  const recent = useRecentActivity(5);

  return (
    <Section
      delay={0.15}
      eyebrow="Live"
      eyebrowIcon={<Zap size={11} />}
      title="Recent activity"
      description="Latest proposals across every organisation you sign for."
    >
      {recent.loading ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} tone="dark" className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : recent.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-8 text-center text-sm text-white/40">
          No proposals yet. Open a wallet from the sidebar and create one.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {recent.rows.map((r) => {
            const StatusIcon =
              r.status === ProposalStatus.Executed
                ? Rocket
                : r.status === ProposalStatus.Approved
                ? CheckCircle2
                : r.status === ProposalStatus.Cancelled
                ? X
                : Clock;
            const statusTone =
              r.status === ProposalStatus.Executed
                ? "text-brand-green"
                : r.status === ProposalStatus.Approved
                ? "text-cyan-300"
                : r.status === ProposalStatus.Cancelled
                ? "text-rose-300"
                : "text-amber-300";
            const statusBg =
              r.status === ProposalStatus.Executed
                ? "bg-brand-green/10"
                : r.status === ProposalStatus.Approved
                ? "bg-cyan-300/10"
                : r.status === ProposalStatus.Cancelled
                ? "bg-rose-300/10"
                : "bg-amber-300/10";
            return (
              <li key={r.proposalPda}>
                <Link
                  href={`/app/proposals/${encodeURIComponent(r.proposalPda)}`}
                  className="group flex items-center gap-3 rounded-2xl border border-white/5 bg-white/[0.02] px-3 py-3 transition-colors hover:border-brand-green/30 hover:bg-white/[0.05]"
                >
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${statusBg} ${statusTone}`}>
                    <StatusIcon size={14} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-sm font-semibold text-white">
                        {r.walletName}
                      </span>
                      <span className="font-mono text-xs text-white/40">
                        #{r.proposalIndex.toString()}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-white/40">
                      <span className={statusTone}>{r.statusLabel}</span>
                      {r.proposedAt > 0n && (
                        <>
                          <span className="text-white/20">·</span>
                          <span>{relativeTime(r.proposedAt)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <ArrowRight
                    size={14}
                    className="shrink-0 text-white/30 transition-all group-hover:translate-x-0.5 group-hover:text-brand-green"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Section({
  delay,
  eyebrow,
  eyebrowIcon,
  title,
  description,
  children,
}: {
  delay: number;
  eyebrow: string;
  eyebrowIcon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl border border-white/10 bg-black px-5 py-6 shadow-card-dark sm:px-7 sm:py-8"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-brand-green/10 blur-3xl"
      />
      <div className="relative z-10 flex flex-col gap-4">
        <header className="flex flex-col gap-1.5">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-brand-green/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-green">
            {eyebrowIcon}
            {eyebrow}
          </span>
          <h2 className="font-display text-xl font-bold leading-tight tracking-tight text-brand-white sm:text-2xl">
            {title}
          </h2>
          <p className="text-sm text-white/60">{description}</p>
        </header>
        <div>{children}</div>
      </div>
    </motion.section>
  );
}

