"use client";

// Wallet hub — retail rebuild (locked 2026-04-30).
//
// Replaces the previous "treasury console" dashboard. Same data hooks
// (useUserStats / useRecentActivity / useActionNeeded / memberships
// query), completely new presentation:
//   - Friendly greeting, no pubkey on display.
//   - Light cards for each shared wallet, with a live-pulse pending
//     badge if anything in that wallet needs the user's attention.
//   - Plain-language "Needs your approval" inbox.
//   - Simplified recent activity ("Sent" / "Waiting" / "Ready to send"
//     instead of Active/Approved/Executed).
//   - First-visit empty state routes to /welcome (the retail story
//     flow), not the legacy CreateWalletCard wizard.
//
// The legacy wizard (CreateWalletCard, WalletPanel) and WorkflowTips
// are intentionally NOT rendered here — they're being retired.

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Bell, Contact, Lock, Plus, Settings as SettingsIcon, Users } from "lucide-react";
import { fetchOnchainMemberships, type OnchainMembership } from "@/lib/memberships/client";
import { useRecentActivity, type RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useActionNeeded, type ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import { useBatchApprove } from "@/lib/hooks/useBatchApprove";
import { findVaultAddress, ProposalStatus } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Button } from "@/components/retail/Button";
import { relativeTime } from "@/lib/util/relativeTime";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { formatBalance } from "@/lib/retail/format";

export default function WalletDashboard() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const address = wallet.publicKey?.toBase58() ?? "";
  const reduce = useReducedMotion();

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  const recent = useRecentActivity(5);
  const action = useActionNeeded();

  const wallets = memberships.data ?? [];
  const stillLoading = memberships.isLoading;
  const isFirstVisit = !stillLoading && wallets.length === 0;

  // Batch-fetch every wallet's vault balance in a single RPC. Re-keys
  // on the wallet set so the cache invalidates cleanly when memberships
  // change. Auto-refetch every 30s keeps the numbers fresh in the
  // background without explicit subscriptions.
  const walletKeys = wallets
    .map((m) => m.wallet)
    .sort()
    .join(",");
  const balancesQuery = useQuery({
    queryKey: ["dashboard-balances", walletKeys],
    queryFn: async () => {
      const map = new Map<string, number>();
      if (wallets.length === 0) return map;
      const vaults = wallets.map((m) => {
        const [vault] = findVaultAddress(
          new PublicKey(m.wallet),
          CLEAR_WALLET_PROGRAM_ID,
        );
        return vault;
      });
      const infos = await connection.getMultipleAccountsInfo(vaults);
      wallets.forEach((m, i) => {
        map.set(m.wallet, infos[i]?.lamports ?? 0);
      });
      return map;
    },
    enabled: wallets.length > 0,
    staleTime: 15_000,
    refetchInterval: 30_000,
  });

  return (
    <div className="flex flex-col gap-6">
      <Greeting reduce={!!reduce} />

      {isFirstVisit ? (
        <FirstVisitCard />
      ) : (
        <WalletsGrid
          wallets={wallets}
          pendingByWallet={recent.pendingByWallet}
          balances={balancesQuery.data}
          loadingBalances={balancesQuery.isLoading}
          loading={stillLoading}
          reduce={!!reduce}
        />
      )}

      {!isFirstVisit && action.rows.length > 0 && (
        <ActionNeededSection rows={action.rows} reduce={!!reduce} />
      )}

      {!isFirstVisit && recent.rows.length > 0 && (
        <RecentActivitySection rows={recent.rows} reduce={!!reduce} />
      )}

      {!isFirstVisit && <ShortcutGrid reduce={!!reduce} />}

      {!isFirstVisit && (
        <Link
          href="/welcome"
          className={
            "group inline-flex items-center justify-center gap-2 self-start rounded-card " +
            "border border-border-soft bg-surface-raised px-5 py-3 text-sm font-medium text-text-strong shadow-card-rest " +
            "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <Plus className="h-4 w-4" aria-hidden="true" />
          Create another shared wallet
          <ArrowRight
            className="h-4 w-4 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden="true"
          />
        </Link>
      )}
    </div>
  );
}

// ─── Greeting ──────────────────────────────────────────────────────

function Greeting({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35 }}
      className="text-center"
    >
      <h1 className="font-display text-display-xs leading-tight text-text-strong">
        Welcome back
      </h1>
      <p className="mt-1 text-base text-text-soft">
        Your shared wallets and what needs your attention.
      </p>
    </motion.div>
  );
}

// Shortcut row — quick links to the root-level retail destinations
// other than the wallet flow itself. Surfaced on the dashboard so a
// user with several wallets can still reach Contacts / Settings /
// Privacy without drilling into a wallet first.
function ShortcutGrid({ reduce }: { reduce: boolean }) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35, delay: 0.04 }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      <ShortcutCard
        href="/welcome"
        Icon={Plus}
        label="New wallet"
        body="Spin up another shared wallet."
      />
      <ShortcutCard
        href="/app/contacts"
        Icon={Contact}
        label="Contacts"
        body="Names you've saved."
      />
      <ShortcutCard
        href="/app/settings"
        Icon={SettingsIcon}
        label="Settings"
        body="Account + connection."
      />
      <ShortcutCard
        href="/privacy"
        Icon={Lock}
        label="Privacy"
        body="How your rules stay yours."
      />
    </motion.div>
  );
}

function ShortcutCard({
  href,
  Icon,
  label,
  body,
}: {
  href: string;
  Icon: typeof Plus;
  label: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex flex-col items-start gap-2 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest " +
        "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>
      <span className="text-sm font-medium text-text-strong">{label}</span>
      <span className="text-xs leading-snug text-text-soft">{body}</span>
    </Link>
  );
}

// ─── First-visit empty state ───────────────────────────────────────

function FirstVisitCard() {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-8 shadow-card-rest">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/10">
          <Users className="h-7 w-7 text-accent" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="font-display text-display-xs text-text-strong">
            You don&rsquo;t have a shared wallet yet
          </h2>
          <p className="mt-2 max-w-sm text-base text-text-soft">
            Start one for your roommates, your trip, your family. You can
            add friends after.
          </p>
        </div>
        <Link href="/welcome">
          <Button size="lg">
            Create your first wallet
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

// ─── Wallets grid ──────────────────────────────────────────────────

interface WalletsGridProps {
  wallets: OnchainMembership[];
  pendingByWallet: Map<string, number>;
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  loading: boolean;
  reduce: boolean;
}

function WalletsGrid({
  wallets,
  pendingByWallet,
  balances,
  loadingBalances,
  loading,
  reduce,
}: WalletsGridProps) {
  return (
    <section>
      <SectionLabel>Your wallets</SectionLabel>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {loading && wallets.length === 0 ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          wallets.map((m, i) => (
            <WalletCard
              key={m.wallet}
              membership={m}
              pendingCount={pendingByWallet.get(m.wallet) ?? 0}
              balanceLamports={balances?.get(m.wallet) ?? null}
              loadingBalance={loadingBalances}
              delay={i * 0.04}
              reduce={reduce}
            />
          ))
        )}
      </div>
    </section>
  );
}

interface WalletCardProps {
  membership: OnchainMembership;
  pendingCount: number;
  balanceLamports: number | null;
  loadingBalance: boolean;
  delay: number;
  reduce: boolean;
}

function WalletCard({
  membership,
  pendingCount,
  balanceLamports,
  loadingBalance,
  delay,
  reduce,
}: WalletCardProps) {
  const name = membership.wallet_name ?? "Wallet";
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const balance =
    balanceLamports !== null ? formatBalance(balanceLamports) : null;

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(name)}`}
        className={
          "group relative flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-display text-xl text-text-strong">
              {name}
            </p>
            {loadingBalance && balance === null ? (
              <div className="mt-1 h-5 w-20 animate-pulse rounded bg-border-soft" />
            ) : (
              <p className="mt-1 font-display text-base text-text-strong">
                {balance ? balance.amount : "0"}{" "}
                <span className="text-text-soft">
                  {balance?.ticker ?? "SOL"}
                </span>
              </p>
            )}
          </div>
          <ArrowRight
            className="mt-1 h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden="true"
          />
        </div>
        {pendingCount > 0 && (
          <div className="inline-flex items-center gap-1.5 self-start rounded-full bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {pendingCount} need{pendingCount === 1 ? "s" : ""} approval
          </div>
        )}
      </Link>
    </motion.div>
  );
}

function CardSkeleton() {
  return (
    <div className="h-[110px] rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="h-5 w-1/3 animate-pulse rounded bg-border-soft" />
      <div className="mt-2 h-5 w-16 animate-pulse rounded bg-border-soft" />
    </div>
  );
}

// ─── Action needed ─────────────────────────────────────────────────

interface ActionNeededProps {
  rows: ActionNeededRow[];
  reduce: boolean;
}

function ActionNeededSection({ rows, reduce }: ActionNeededProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const batch = useBatchApprove();
  const running = batch.progress !== null && batch.progress.completed < batch.progress.total && !batch.progress.error;
  const showApproveAll = rows.length >= 2;

  const handleApproveAll = () => {
    batch.approveAll(
      rows.map((r) => ({
        walletName: r.walletName,
        proposalPda: r.proposalPda,
        label: `${friendlyIntentLabel(r.intentTemplate)} in ${r.walletName}`,
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
          <ActionRow key={row.proposalPda} row={row} />
        ))}
      </ul>
    </motion.section>
  );
}

function BatchProgressRow({
  progress,
  onDismiss,
}: {
  progress: { total: number; completed: number; error?: string; currentLabel?: string };
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

function ActionRow({ row }: { row: ActionNeededRow }) {
  const friendlyTemplate = friendlyIntentLabel(row.intentTemplate);
  return (
    <li>
      <Link
        href={`/app/proposals/${row.proposalPda}`}
        className={
          "group flex items-center justify-between gap-3 py-3 " +
          "transition-colors duration-base ease-out-soft hover:text-text-strong " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        }
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-strong">
            {friendlyTemplate}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-soft">
            in {row.walletName} · {row.approvalsCollected} of{" "}
            {row.approverCount} approved
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

// ─── Recent activity ───────────────────────────────────────────────

interface RecentActivityProps {
  rows: RecentActivityRow[];
  reduce: boolean;
}

function RecentActivitySection({ rows, reduce }: RecentActivityProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.35, delay: 0.12 }}
    >
      <SectionLabel>Recent activity</SectionLabel>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        {rows.map((row) => (
          <ActivityRow key={row.proposalPda} row={row} />
        ))}
      </ul>
    </motion.section>
  );
}

function ActivityRow({ row }: { row: RecentActivityRow }) {
  const time = relativeTime(Number(row.proposedAt) * 1000);
  return (
    <li>
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
            {row.walletName}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            <span className={statusColor(row.status)}>{friendlyStatus(row.status)}</span>
            <span className="mx-1.5 text-text-soft/40">·</span>
            <span>{time}</span>
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

// ─── Bits & pieces ─────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
      {children}
    </h2>
  );
}

function statusColor(s: RecentActivityRow["status"]): string {
  switch (s) {
    case ProposalStatus.Active:
      return "text-warning";
    case ProposalStatus.Approved:
      return "text-accent";
    case ProposalStatus.Executed:
      return "text-success";
    case ProposalStatus.Cancelled:
      return "text-text-soft";
    default:
      return "text-text-soft";
  }
}

