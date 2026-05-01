"use client";

// Wallet detail — retail rebuild (locked 2026-04-30).
//
// Replaces the legacy power-user wallet page (chain bindings,
// intent CRUD, PDA panels, DKG progress, raw approver tables).
// What a retail user actually needs to see and do here:
//
//   - Which wallet is this (name + member count).
//   - Send money (route to /send?wallet=…).
//   - Invite a friend (route to /welcome/invite?wallet=…).
//   - What's waiting on me ("needs your approval", filtered).
//   - What just happened ("recent activity", filtered).
//
// Power-user surfaces (chain bindings, intent management, raw PDA
// inspection) are intentionally not rendered here. They still exist
// in the codebase and will be cleaned up after the retail surface
// covers create / send / approve / member management.

import { useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Bell, Download, Globe, Lock, Send, ShieldCheck, Users } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { useRecentActivity, type RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useActionNeeded, type ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import { useBatchApprove } from "@/lib/hooks/useBatchApprove";
import { ProposalStatus } from "@/lib/msig";
import { Button } from "@/components/retail/Button";
import { MemberAvatarStack } from "@/components/retail/MemberAvatar";
import { relativeTime } from "@/lib/util/relativeTime";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { formatBalance } from "@/lib/retail/format";

export default function WalletDetailPage() {
  const params = useParams<{ name: string }>();
  const rawName = params?.name ?? "";
  const name = useMemo(() => {
    try {
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  }, [rawName]);
  const reduce = useReducedMotion();
  const { connection } = useConnection();

  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });

  const intentsQuery = useQuery({
    queryKey: ["wallet-intents", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return [];
      // `wallet.intent_index` is the *highest used* slot (program
      // creates the wallet with intent_index=2 covering slots 0/1/2,
      // and bumps intent_index when a new intent lands). listIntents
      // iterates inclusive 0..=upTo.
      const upTo = walletQuery.data.account.intentIndex;
      return listIntents(connection, walletQuery.data.pda, upTo);
    },
    enabled: !!walletQuery.data,
    staleTime: 30_000,
  });

  // Vault balance — the lamports actually held by this wallet's vault
  // PDA. Refreshed every 15s; invalidated after a successful Send so
  // the new balance shows up immediately.
  const balanceQuery = useQuery({
    queryKey: ["wallet-balance", walletQuery.data?.pda.toBase58() ?? null],
    queryFn: async () => {
      if (!walletQuery.data) return 0;
      const [vault] = findVaultAddress(
        walletQuery.data.pda,
        CLEAR_WALLET_PROGRAM_ID,
      );
      return connection.getBalance(vault, "confirmed");
    },
    enabled: !!walletQuery.data,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  // Members = unique approvers across all live intents in this wallet.
  // We don't render raw addresses, but we DO derive deterministic
  // avatars from each so the wallet hero feels populated by friends
  // rather than a counter.
  const memberAddresses = useMemo(() => {
    if (!intentsQuery.data) return [];
    const seen = new Set<string>();
    for (const it of intentsQuery.data) {
      if (!it.account) continue;
      for (const a of it.account.approvers) seen.add(a);
    }
    return Array.from(seen);
  }, [intentsQuery.data]);
  const memberCount = intentsQuery.data ? memberAddresses.length : null;

  // Whether the wallet has any active intents — gates the "Send money"
  // CTA. With zero intents, the program can't accept a proposal, so we
  // route the user to the one-tap setup screen instead.
  const hasIntents = useMemo(() => {
    if (!intentsQuery.data) return null;
    return intentsQuery.data.some((it) => it.account !== null);
  }, [intentsQuery.data]);

  const allActivity = useRecentActivity(50);
  const allAction = useActionNeeded();

  const walletActivity = useMemo(
    () =>
      allActivity.rows
        .filter((r) => r.walletName === name)
        .slice(0, 5),
    [allActivity.rows, name],
  );
  const walletAction = useMemo(
    () => allAction.rows.filter((r) => r.walletName === name),
    [allAction.rows, name],
  );

  if (walletQuery.isLoading) {
    return <DetailSkeleton />;
  }
  if (!walletQuery.data) {
    return <NotFound name={name} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <Hero
        name={name}
        memberCount={memberCount}
        memberAddresses={memberAddresses}
        loadingMembers={intentsQuery.isLoading}
        balanceLamports={balanceQuery.data ?? null}
        loadingBalance={balanceQuery.isLoading}
        reduce={!!reduce}
      />
      <Actions
        name={name}
        hasIntents={hasIntents}
        reduce={!!reduce}
      />
      {walletAction.length > 0 && (
        <ActionNeededSection rows={walletAction} reduce={!!reduce} />
      )}
      {walletActivity.length > 0 ? (
        <ActivitySection rows={walletActivity} reduce={!!reduce} />
      ) : (
        <ActivityEmptyState reduce={!!reduce} />
      )}
    </div>
  );
}

// ─── Top breadcrumb ────────────────────────────────────────────────

function BackLink() {
  return (
    <Link
      href="/app/wallet"
      className={
        "-ml-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
        "transition-colors duration-base ease-out-soft hover:text-text-strong " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      Wallets
    </Link>
  );
}

// ─── Hero card ─────────────────────────────────────────────────────

interface HeroProps {
  name: string;
  memberCount: number | null;
  memberAddresses: string[];
  loadingMembers: boolean;
  balanceLamports: number | null;
  loadingBalance: boolean;
  reduce: boolean;
}


function Hero({
  name,
  memberCount,
  memberAddresses,
  loadingMembers,
  balanceLamports,
  loadingBalance,
  reduce,
}: HeroProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const balance =
    balanceLamports !== null ? formatBalance(balanceLamports) : null;

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
    >
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        Shared wallet
      </p>
      <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
        {name}
      </h1>

      {/* Balance — biggest visual hierarchy after the name. SOL is
          the primary currency; secondary chains pick up balances in
          their own ticker once those queries land. */}
      <div className="mt-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
          Balance
        </p>
        {loadingBalance ? (
          <div className="mx-auto mt-1 h-9 w-40 animate-pulse rounded bg-border-soft" />
        ) : (
          <p className="mt-1 font-display text-display-xs text-text-strong">
            {balance ? balance.amount : "0"}{" "}
            <span className="text-text-soft">
              {balance?.ticker ?? "SOL"}
            </span>
          </p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-sm text-text-soft">
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}/members`}
          aria-label="View members"
          className={
            "group inline-flex items-center gap-2 rounded-soft px-1 py-0.5 -mx-1 " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          {loadingMembers ? (
            <>
              <Users className="h-4 w-4" aria-hidden="true" />
              <span className="inline-block h-4 w-24 animate-pulse rounded bg-border-soft" />
            </>
          ) : memberAddresses.length > 0 ? (
            <>
              <MemberAvatarStack
                addresses={memberAddresses}
                size="md"
                max={4}
              />
              <span>
                {memberCount} {memberCount === 1 ? "member" : "members"}
              </span>
              <ArrowRight
                className="h-3.5 w-3.5 -ml-0.5 text-text-soft/60 transition-transform duration-base group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </>
          ) : (
            <>
              <Users className="h-4 w-4" aria-hidden="true" />
              <span>1 member</span>
            </>
          )}
        </Link>
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}/rules`}
          className={
            "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <ShieldCheck
            className="h-3 w-3"
            aria-hidden="true"
            strokeWidth={2}
          />
          Spending rules
        </Link>
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}/chains`}
          className={
            "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <Globe className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          Chains
        </Link>
        <Link
          href="/privacy"
          className={
            "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-xs font-medium text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          Private
        </Link>
      </div>
    </motion.section>
  );
}

// ─── Quick actions row ─────────────────────────────────────────────

function Actions({
  name,
  hasIntents,
  reduce,
}: {
  name: string;
  /// null while loading, false once we've confirmed no intents exist.
  hasIntents: boolean | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(name);

  // Default to the Send CTA while loading so we don't flash the setup
  // affordance for half a second before the intents query resolves.
  const sendingReady = hasIntents !== false;

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35, delay: 0.04 }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {sendingReady ? (
        <Link href={`/send?wallet=${encoded}`} className="block">
          <Button size="lg" fullWidth>
            <Send className="h-4 w-4" aria-hidden="true" />
            Send money
          </Button>
        </Link>
      ) : (
        <Link href={`/app/wallet/${encoded}/setup`} className="block">
          <Button size="lg" fullWidth>
            <Send className="h-4 w-4" aria-hidden="true" />
            Set up sending
          </Button>
        </Link>
      )}
      <Link href={`/app/wallet/${encoded}/receive`} className="block">
        <Button size="lg" variant="secondary" fullWidth>
          <Download className="h-4 w-4" aria-hidden="true" />
          Receive money
        </Button>
      </Link>
    </motion.div>
  );
}

// ─── Action needed (filtered to this wallet) ───────────────────────

interface ActionNeededProps {
  rows: ActionNeededRow[];
  reduce: boolean;
}

function ActionNeededSection({ rows, reduce }: ActionNeededProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const batch = useBatchApprove();
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
      {...motionProps}
      transition={{ duration: 0.35, delay: 0.08 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-text-strong">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Bell className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          Needs your approval
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-soft">{rows.length}</span>
          {showApproveAll && (
            <button
              type="button"
              onClick={handleApproveAll}
              disabled={running}
              className={
                "inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white shadow-accent-rest " +
                "transition-[background-color,box-shadow,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-60 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              {running ? "Approving…" : "Approve all"}
            </button>
          )}
        </div>
      </header>

      {batch.progress && (
        <BatchProgressRow progress={batch.progress} onDismiss={batch.reset} />
      )}

      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((row) => (
          <li key={row.proposalPda}>
            <Link
              href={`/app/proposals/${row.proposalPda}`}
              className={
                "group flex items-center justify-between gap-3 py-3 " +
                "transition-colors duration-base ease-out-soft " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-strong">
                  {friendlyIntentLabel(row.intentTemplate)}
                </p>
                <p className="mt-0.5 truncate text-xs text-text-soft">
                  {row.approvalsCollected} of {row.approverCount} approved
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
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
            ? `Stopped — approved ${progress.completed} of ${progress.total}`
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

// ─── Recent activity (filtered to this wallet) ─────────────────────

interface ActivityProps {
  rows: RecentActivityRow[];
  reduce: boolean;
}

function ActivitySection({ rows, reduce }: ActivityProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.35, delay: 0.12 }}
    >
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        Recent activity
      </h2>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        {rows.map((row) => (
          <li key={row.proposalPda}>
            <Link
              href={`/app/proposals/${row.proposalPda}`}
              className={
                "group flex items-center justify-between gap-3 px-5 py-3 " +
                "transition-colors duration-base ease-out-soft hover:bg-canvas/40 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
              }
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-strong">
                  {friendlyStatus(row.status)}
                </p>
                <p className="mt-0.5 text-xs text-text-soft">
                  {relativeTime(Number(row.proposedAt) * 1000)}
                </p>
              </div>
              <ArrowRight
                className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

function ActivityEmptyState({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.35, delay: 0.12 }}
      className="rounded-card border border-dashed border-border-soft bg-surface-raised p-6 text-center shadow-card-rest"
    >
      <p className="font-display text-base text-text-strong">
        Nothing here yet
      </p>
      <p className="mt-1 text-sm text-text-soft">
        When you send money or invite friends, the activity will show up
        here.
      </p>
    </motion.section>
  );
}

// ─── Loading + not-found ───────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="-ml-2 h-7 w-24 animate-pulse rounded bg-border-soft" />
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 shadow-card-rest">
        <div className="h-3 w-24 animate-pulse rounded bg-border-soft" />
        <div className="mt-3 h-9 w-2/3 animate-pulse rounded bg-border-soft" />
        <div className="mt-4 h-4 w-32 animate-pulse rounded bg-border-soft" />
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="h-tap-lg animate-pulse rounded-soft bg-border-soft" />
        <div className="h-tap-lg animate-pulse rounded-soft bg-border-soft" />
      </div>
    </div>
  );
}

function NotFound({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-6">
      <BackLink />
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
        <h1 className="font-display text-display-xs text-text-strong">
          We couldn&rsquo;t find {name}
        </h1>
        <p className="mt-2 max-w-md text-text-soft">
          The wallet may have been renamed, or you may not be a member.
          Head back to the dashboard to see your wallets.
        </p>
        <Link href="/app/wallet" className="mt-6 inline-block">
          <Button size="md">
            Back to wallets
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

