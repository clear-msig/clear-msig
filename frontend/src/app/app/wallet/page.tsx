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

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Bell, BellRing, Contact, Eye, Lock, Pin, PinOff, Settings as SettingsIcon, Users, X } from "lucide-react";
import {
  isWalletPinned,
  sortPinnedFirst,
  subscribePinnedWallets,
  togglePinnedWallet,
} from "@/lib/security/pinnedWallets";
import { fetchOnchainMemberships, type OnchainMembership } from "@/lib/memberships/client";
import {
  useWatchedWallets,
  type WatchedMembership,
} from "@/lib/hooks/useWatchedWallets";
import {
  addWatchedWallet,
  removeWatchedWallet,
} from "@/lib/retail/watchedWallets";
import { useRecentActivity, type RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useActionNeeded, type ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import { useActionNotifications } from "@/lib/hooks/useActionNotifications";
import { useBatchApprove } from "@/lib/hooks/useBatchApprove";
import { listBatches } from "@/lib/hooks/useBatchSend";
import { findVaultAddress, ProposalStatus } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Button } from "@/components/retail/Button";
import { relativeTime } from "@/lib/util/relativeTime";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { formatBalance } from "@/lib/retail/format";
import { toDisplayName } from "@/lib/retail/walletNames";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";

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
  const watched = useWatchedWallets();

  const wallets = memberships.data ?? [];
  const stillLoading = memberships.isLoading;
  // Distinguish "RPC errored" from "user genuinely has no wallets."
  // Without this guard, a transient memberships failure renders the
  // first-visit CTA — which then sends the user through /welcome to
  // create a duplicate wallet.
  const hasError = !stillLoading && memberships.isError;
  const isFirstVisit = !stillLoading && !hasError && wallets.length === 0;

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
      <UnsupportedSignerBanner />
      <Greeting reduce={!!reduce} />

      {hasError ? (
        <MembershipsErrorCard onRetry={() => memberships.refetch()} />
      ) : isFirstVisit && watched.rows.length === 0 ? (
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

      {!hasError && (
        <WatchedWalletsSection
          rows={watched.rows}
          loading={watched.loading}
          pendingByWallet={recent.pendingByWallet}
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
      transition={{ duration: 0.2 }}
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
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
    >
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
  Icon: typeof Contact;
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

// ─── Memberships error state ───────────────────────────────────────
//
// When the on-chain memberships fetch fails (RPC blip, connection
// dropped mid-load), we used to render the first-visit CTA which
// tells the user to "Create your first wallet" — for someone who
// already has wallets, that's a dangerous nudge. This card replaces
// the silent fallback with an explicit retry.

function MembershipsErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-card border border-warning/30 bg-warning/[0.06] p-6 shadow-card-rest">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-warning">
        Couldn&rsquo;t load your wallets
      </p>
      <p className="mt-2 text-sm text-text-strong">
        Quick hiccup talking to the network. Your wallets are safe; we
        just couldn&rsquo;t fetch them right now.
      </p>
      <Button size="md" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
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
  // Re-sort whenever the user pins/unpins. The hook subscribes to
  // both the same-tab event and cross-tab storage events so a pin
  // change in another tab also bubbles up here.
  const [pinTick, setPinTick] = useState(0);
  useEffect(() => subscribePinnedWallets(() => setPinTick((n) => n + 1)), []);
  const ordered = useMemo(
    () => sortPinnedFirst(wallets, (m) => m.wallet_name ?? ""),
    [wallets, pinTick],
  );

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
          ordered.map((m, i) => (
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
  const onChainName = membership.wallet_name ?? "Wallet";
  // The on-chain name carries a creator-derived suffix to keep PDAs
  // unique per user (see lib/retail/walletNames). Strip it for
  // display; URLs and API calls keep using the on-chain form.
  const name = toDisplayName(onChainName);
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const balance =
    balanceLamports !== null ? formatBalance(balanceLamports) : null;
  const [pinned, setPinned] = useState(false);
  useEffect(() => {
    setPinned(isWalletPinned(onChainName));
    return subscribePinnedWallets(() => setPinned(isWalletPinned(onChainName)));
  }, [onChainName]);
  const handlePinClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Card body is a <Link>; the pin button is nested. Stop
    // propagation so a click on the pin doesn't navigate to the
    // wallet detail.
    e.preventDefault();
    e.stopPropagation();
    setPinned(togglePinnedWallet(onChainName));
  };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.35, delay, ease: [0.22, 1, 0.36, 1] }}
      className="relative"
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(onChainName)}`}
        className={
          "group relative flex flex-col gap-3 rounded-card border bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
          (pinned ? "border-accent/40" : "border-border-soft")
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-display text-xl text-text-strong">
              {pinned && (
                <Pin
                  className="h-3.5 w-3.5 shrink-0 text-accent"
                  strokeWidth={2.5}
                  aria-label="Pinned"
                />
              )}
              <span className="truncate">{name}</span>
            </p>
            {loadingBalance && balance === null ? (
              <div className="mt-1 h-5 w-20 animate-pulse rounded bg-border-soft" />
            ) : (
              <p className="mt-1 font-display text-base text-text-strong">
                {balance ? balance.amount : "0"}{" "}
                <span className="text-text-strong/70">
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
      <button
        type="button"
        onClick={handlePinClick}
        aria-label={pinned ? `Unpin ${name}` : `Pin ${name} to the top`}
        title={pinned ? "Unpin" : "Pin to top"}
        className={
          "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-surface-raised " +
          "transition-[color,border-color,transform] duration-base ease-out-soft " +
          (pinned
            ? "border-accent/40 text-accent hover:border-accent"
            : "border-border-soft text-text-soft/60 hover:border-accent hover:text-accent") +
          " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        {pinned ? (
          <Pin className="h-3.5 w-3.5" strokeWidth={2} />
        ) : (
          <PinOff className="h-3.5 w-3.5" strokeWidth={2} />
        )}
      </button>
    </motion.div>
  );
}

// Geometry-matched skeleton for WalletCard. The previous version
// was 110px tall and had two short stripes — real cards land at
// 140-170px and have title-line + balance-line + optional pending
// pill, so the swap-in caused a visible layout jump. This shape
// matches the populated card closely enough that the transition
// looks like content fading in, not the layout shifting.
function CardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Title line — same width as font-display text-xl. */}
          <div className="h-6 w-1/2 animate-pulse rounded bg-border-soft" />
          {/* Balance line — slightly tighter than the title. */}
          <div className="mt-2.5 h-5 w-24 animate-pulse rounded bg-border-soft/80" />
        </div>
        {/* Pin button placeholder — keeps the right edge stable. */}
        <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-border-soft/60" />
      </div>
      {/* Pending-approval pill — most loaded cards have at least
          one badge slot worth of vertical space. Quieter pulse so
          it doesn't read as required. */}
      <div className="mt-4 h-6 w-32 animate-pulse rounded-full bg-border-soft/40" />
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
  // Per-tab dismissal so we don't nag a user who's already declined.
  // Persisted in sessionStorage so a navigate-away-and-back keeps it
  // hidden, but a fresh tab gets the prompt again — they may have
  // changed their mind, or be on a different device.
  const notif = useActionNotifications();
  const [dismissedNotifPrompt, setDismissedNotifPrompt] = useState<boolean>(
    () => {
      if (typeof window === "undefined") return false;
      try {
        return (
          window.sessionStorage.getItem("clear.notif-prompt.dismissed") ===
          "1"
        );
      } catch {
        return false;
      }
    },
  );
  const showNotifPrompt =
    notif.supported &&
    notif.permission === "default" &&
    rows.length > 0 &&
    !dismissedNotifPrompt;
  const running = batch.progress !== null && batch.progress.completed < batch.progress.total && !batch.progress.error;
  const showApproveAll = rows.length >= 2;

  // Group rows that came out of /send/batch under one card so the
  // inbox doesn't render 50 near-identical lines for a payroll. The
  // batch metadata (id + member proposals) lives in localStorage,
  // stamped by useBatchSend after each row lands.
  const grouped = useMemo(() => groupRowsByBatch(rows), [rows]);

  const approveTargets = (subset: ActionNeededRow[]) =>
    subset.map((r) => ({
      walletName: r.walletName,
      proposalPda: r.proposalPda,
      label: `${friendlyIntentLabel(r.intentTemplate)} in ${toDisplayName(r.walletName)}`,
    }));

  const handleApproveAll = () => batch.approveAll(approveTargets(rows));
  const handleApproveBatch = (batchRows: ActionNeededRow[]) =>
    batch.approveAll(approveTargets(batchRows));

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
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
      {!batch.progress && rows.length > 0 && (
        <p className="mt-2 text-[11px] text-text-soft">
          Approving fires one wallet popup per request. Tap Approve in each.
        </p>
      )}

      {showNotifPrompt && (
        <div className="mt-3 flex items-center gap-3 rounded-soft border border-accent/30 bg-accent/[0.04] px-3 py-2">
          <BellRing
            className="h-4 w-4 shrink-0 text-accent"
            strokeWidth={2}
            aria-hidden="true"
          />
          <p className="min-w-0 flex-1 text-[11px] text-text-strong">
            Want a browser ping when something else needs you?{" "}
            <span className="text-text-soft">
              Only fires when this tab is in the background.
            </span>
          </p>
          <button
            type="button"
            onClick={() => void notif.request()}
            className={
              "shrink-0 rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-white " +
              "transition-[background-color,transform] duration-base ease-out-soft " +
              "hover:bg-accent-hover active:scale-[0.98] " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            Enable
          </button>
          <button
            type="button"
            onClick={() => {
              setDismissedNotifPrompt(true);
              try {
                window.sessionStorage.setItem(
                  "clear.notif-prompt.dismissed",
                  "1",
                );
              } catch {
                /* storage blocked — keep state local to this view */
              }
            }}
            aria-label="Dismiss notifications prompt"
            className="shrink-0 rounded-soft p-1 text-text-soft transition-colors hover:bg-canvas hover:text-text-strong"
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </div>
      )}

      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {grouped.map((entry: GroupedActionRow) =>
          entry.kind === "single" ? (
            <ActionRow key={entry.row.proposalPda} row={entry.row} />
          ) : (
            <BatchActionRow
              key={entry.batchId}
              batchId={entry.batchId}
              walletName={entry.walletName}
              rows={entry.rows}
              disabled={running}
              onApprove={() => handleApproveBatch(entry.rows)}
            />
          ),
        )}
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

type GroupedActionRow =
  | { kind: "single"; row: ActionNeededRow }
  | {
      kind: "batch";
      batchId: string;
      walletName: string;
      rows: ActionNeededRow[];
    };

/// Collapse pending rows that came out of /send/batch under a single
/// entry. We look up the batch records the send hook stamps into
/// `clear-msig:batches:v1` and bucket rows whose proposal PDA is in
/// any record. Rows that belong to no batch fall through as singles.
/// Order is preserved within a batch (the action-needed feed is
/// already sorted oldest-first, which works for payroll display too).
function groupRowsByBatch(rows: ActionNeededRow[]): GroupedActionRow[] {
  if (rows.length === 0) return [];
  const batches = listBatches();
  if (batches.length === 0) {
    return rows.map((row) => ({ kind: "single", row }));
  }
  const batchByProposal = new Map<string, string>();
  const batchMeta = new Map<string, { walletName: string }>();
  for (const b of batches) {
    batchMeta.set(b.batchId, { walletName: b.walletName });
    for (const pda of b.proposalPdas) batchByProposal.set(pda, b.batchId);
  }
  const out: GroupedActionRow[] = [];
  const grouped = new Map<string, ActionNeededRow[]>();
  for (const row of rows) {
    const batchId = batchByProposal.get(row.proposalPda);
    if (!batchId) {
      out.push({ kind: "single", row });
      continue;
    }
    if (!grouped.has(batchId)) {
      grouped.set(batchId, []);
      // Reserve the slot in the output where this batch lives so
      // mixed feeds (some batched, some single) keep chronological
      // order.
      out.push({
        kind: "batch",
        batchId,
        walletName: batchMeta.get(batchId)?.walletName ?? row.walletName,
        rows: grouped.get(batchId)!,
      });
    }
    grouped.get(batchId)!.push(row);
  }
  // The batch slot's `rows` reference is shared with `grouped`, so
  // pushes above already populated it. Drop empty batches just in
  // case (paranoid: every batch we created has at least one row).
  return out.filter((e) => e.kind === "single" || e.rows.length > 0);
}

function BatchActionRow({
  batchId,
  walletName,
  rows,
  disabled,
  onApprove,
}: {
  batchId: string;
  walletName: string;
  rows: ActionNeededRow[];
  disabled: boolean;
  onApprove: () => void;
}) {
  const allCollected = rows[0]?.approverCount ?? 0;
  const minPending = Math.min(
    ...rows.map((r) => allCollected - r.approvalsCollected),
  );
  return (
    <li>
      <div className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-strong">
            Batch in {toDisplayName(walletName)}
          </p>
          <p className="mt-0.5 truncate text-xs text-text-soft">
            {rows.length} request{rows.length === 1 ? "" : "s"} · waiting on{" "}
            {minPending} more
          </p>
          <Link
            href={`/app/proposals/${rows[0].proposalPda}`}
            className="mt-1 inline-block text-[11px] text-text-soft underline-offset-2 hover:text-accent hover:underline"
            data-batch-id={batchId}
          >
            See first request
          </Link>
        </div>
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className={
            "shrink-0 rounded-full bg-accent px-3 py-1 text-[11px] font-medium text-white shadow-accent-rest " +
            "transition-[background-color,box-shadow,transform] duration-base ease-out-soft " +
            "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98] " +
            "disabled:cursor-not-allowed disabled:opacity-60 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          }
        >
          Approve batch ({rows.length})
        </button>
      </div>
    </li>
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
            in {toDisplayName(row.walletName)} · {row.approvalsCollected} of{" "}
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
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Recent activity</SectionLabel>
        <Link
          href="/app/activity"
          className={
            "inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-soft " +
            "transition-[border-color,color,transform] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
          title="See every proposal across all wallets, with filters + CSV export"
        >
          See all
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        {rows.map((row) => (
          <ActivityRow key={row.proposalPda} row={row} />
        ))}
      </ul>
    </motion.section>
  );
}

function ActivityRow({ row }: { row: RecentActivityRow }) {
  // proposedAt is unix seconds (bigint); relativeTime handles the
  // ms conversion. Passing pre-multiplied milliseconds here was a
  // long-standing bug that printed "just now" forever.
  const time = relativeTime(row.proposedAt);
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
            {toDisplayName(row.walletName)}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            <span className={statusColor(row.status)}>{friendlyStatus(row.status, row.intentTemplate)}</span>
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

// ─── Watching (Tier-4 view-only) ────────────────────────────────
//
// Local-first watch list. Adds a wallet by its on-chain name (with
// the `#XXXXXX` creator suffix) to localStorage; on mount, every
// watched wallet is re-fetched on chain so balances stay current.
// Watching surfaces the same WalletCard the membership grid uses,
// flagged with a 👁 badge so users see at a glance which entries
// they can act on (their memberships) vs read-only (watched).
//
// Sign-action enforcement is implicit: the existing pickSigner()
// check on every send/approve/setup flow returns null when the
// connected wallet isn't in the intent's approver list, and the
// flows surface that as a "your wallet isn't an approver" banner.
// Watching adds rendering rights, not sign rights.

interface WatchedWalletsSectionProps {
  rows: WatchedMembership[];
  loading: boolean;
  pendingByWallet: Map<string, number>;
  reduce: boolean;
}

function WatchedWalletsSection({
  rows,
  loading,
  pendingByWallet,
}: WatchedWalletsSectionProps) {
  const [draft, setDraft] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handleAdd = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    setBusy(true);
    setErr(null);
    try {
      const added = addWatchedWallet(trimmed);
      if (!added) {
        setErr("Already watching that wallet.");
        return;
      }
      setDraft("");
      setShowForm(false);
    } finally {
      setBusy(false);
    }
  };

  if (rows.length === 0 && !showForm) {
    // Surface a single discovery affordance even when the watch
    // list is empty, so users know the feature exists without
    // having to dig into Settings.
    return (
      <section>
        <SectionLabel>Watching</SectionLabel>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          className={
            "mt-3 inline-flex items-center gap-1.5 rounded-full border border-dashed border-border-soft bg-canvas px-3.5 py-1.5 text-xs font-medium text-text-soft " +
            "transition-[border-color,color,transform] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <Eye className="h-3 w-3" aria-hidden="true" />
          Watch a wallet
        </button>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <SectionLabel>Watching</SectionLabel>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="text-[11px] font-medium text-text-soft hover:text-accent"
        >
          {showForm ? "Cancel" : "+ Watch another"}
        </button>
      </div>

      {showForm && (
        <div className="mt-2 flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
          <p className="text-[11px] text-text-soft">
            Paste a wallet name (with the <code>#XXXXXX</code> suffix it
            shows in the URL). Watch lets you see balances + activity
            without sign rights.
          </p>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void handleAdd();
            }}
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="treasury#A1B2C3"
              autoFocus
              spellCheck={false}
              className={
                "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-2.5 py-1.5 font-mono text-xs text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
            <button
              type="submit"
              disabled={busy || !draft.trim()}
              className={
                "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
                "transition-[background-color,transform] duration-base ease-out-soft " +
                "hover:bg-accent-hover active:scale-[0.98] " +
                "disabled:cursor-not-allowed disabled:opacity-50"
              }
            >
              {busy ? "Adding…" : "Watch"}
            </button>
          </form>
          {err && (
            <p className="text-[11px] text-warning" role="alert">
              {err}
            </p>
          )}
        </div>
      )}

      {(rows.length > 0 || loading) && (
        <ul className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
          {loading && rows.length === 0 ? (
            <li className="px-5 py-3 text-xs text-text-soft">
              Loading watched wallets…
            </li>
          ) : (
            rows.map((m) => {
              const display = toDisplayName(m.wallet_name ?? "");
              const pending = pendingByWallet.get(m.wallet) ?? 0;
              return (
                <li key={m.wallet}>
                  <div className="group flex items-center justify-between gap-3 px-5 py-3">
                    <Link
                      href={`/app/wallet/${encodeURIComponent(
                        m.wallet_name ?? "",
                      )}`}
                      className="flex min-w-0 flex-1 items-center gap-3"
                    >
                      <Eye
                        className="h-4 w-4 shrink-0 text-text-soft"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-strong">
                          {display || "Wallet"}
                          <span className="ml-1.5 text-[10px] font-normal uppercase tracking-wide text-text-soft">
                            View only
                          </span>
                        </p>
                        {pending > 0 && (
                          <p className="mt-0.5 text-[11px] text-warning">
                            {pending} active proposal
                            {pending === 1 ? "" : "s"}
                          </p>
                        )}
                      </div>
                    </Link>
                    <button
                      type="button"
                      onClick={() => removeWatchedWallet(m.wallet_name ?? "")}
                      className="shrink-0 rounded-soft px-2 py-1 text-[11px] text-text-soft transition-colors hover:text-warning"
                      aria-label={`Stop watching ${display}`}
                    >
                      Stop
                    </button>
                  </div>
                </li>
              );
            })
          )}
        </ul>
      )}

    </section>
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

