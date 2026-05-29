"use client";

// Wallet hub - retail rebuild (locked 2026-04-30).
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
// are intentionally NOT rendered here - they're being retired.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import { ArrowRight, Bell, Eye, Pin, PinOff, Users, Wallet } from "lucide-react";
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
import { type RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { findVaultAddress, ProposalStatus } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Button } from "@/components/retail/Button";
import { BadgePill } from "@/components/retail/BadgePill";
import { BrandMark } from "@/components/retail/BrandMark";
import { relativeTime } from "@/lib/util/relativeTime";
import {
  friendlyIntentLabel,
  friendlyStatus,
  statusTextColor,
} from "@/lib/retail/labels";
import { proposerDisplayName } from "@/lib/retail/proposerName";
import { formatBalance } from "@/lib/retail/format";
import { toDisplayName } from "@/lib/retail/walletNames";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";
import { UsdHint } from "@/components/retail/UsdHint";

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

  const action = useActionNeeded();
  const recent = action.activity;
  const watched = useWatchedWallets();

  const wallets = memberships.data ?? [];
  const stillLoading = memberships.isLoading;
  // Distinguish "RPC errored" from "user genuinely has no wallets."
  // Without this guard, a transient memberships failure renders the
  // first-visit CTA - which then sends the user through /welcome to
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

  const showStats = !hasError && !isFirstVisit && wallets.length > 0;
  const showRecent = !isFirstVisit && recent.rows.length > 0;
  const showWatched = !hasError;
  const nextWallet = useMemo(() => {
    if (wallets.length === 0) return null;
    const ordered = sortPinnedFirst(wallets, (m) => m.wallet_name ?? "");
    return (
      ordered.find((m) => (recent.pendingByWallet.get(m.wallet) ?? 0) > 0) ??
      ordered[0]
    );
  }, [wallets, recent.pendingByWallet]);

  return (
    <div className="flex flex-col gap-6">
      <UnsupportedSignerBanner />

      {/* Compact hero - left-aligned title + dynamic summary line.
          Replaces the centered "Welcome back" block; gives back the
          vertical real estate to actionable content below. */}
      <Hero
        walletCount={wallets.length}
        pendingCount={action.rows.length}
        loading={stillLoading}
        reduce={!!reduce}
      />

      {/* Stats - three at-a-glance metrics. Total balance sums the
          Solana vault lamports already fetched by balancesQuery; the
          approval card flips to accent when there's anything pending. */}
      {showStats && (
        <StatsRow
          wallets={wallets}
          balances={balancesQuery.data}
          loadingBalances={balancesQuery.isLoading}
          pendingCount={action.rows.length}
          reduce={!!reduce}
        />
      )}

      {!hasError && !isFirstVisit && nextWallet && (
        <NextActionStrip
          wallet={nextWallet}
          pendingCount={action.rows.length}
          firstApprovalHref={
            action.rows[0]
              ? `/app/proposals/${action.rows[0].proposalPda}`
              : null
          }
          reduce={!!reduce}
        />
      )}

      {/* Action-first ordering: surface what needs the user above the
          wallet grid so a returning user sees their inbox without
          having to scroll past their cards. */}

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

      {/* Bottom row - Recent activity (8 cols) sits next to Watching
          (4 cols) on lg+. Either side collapses to full-width when
          its sibling is hidden. */}
      {(showRecent || showWatched) && (
        <div className="grid gap-6 lg:grid-cols-12">
          {showRecent && (
            <div
              className={clsx(
                "min-w-0",
                showWatched ? "lg:col-span-8" : "lg:col-span-12",
              )}
            >
              <RecentActivitySection rows={recent.rows} reduce={!!reduce} />
            </div>
          )}
          {showWatched && (
            <div
              className={clsx(
                "min-w-0",
                showRecent ? "lg:col-span-4" : "lg:col-span-12",
              )}
            >
              <WatchedWalletsSection
                rows={watched.rows}
                loading={watched.loading}
                pendingByWallet={recent.pendingByWallet}
                reduce={!!reduce}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────
//
// Compact left-aligned page header. Replaces the previous centered
// "Welcome back" block - same identity cue (small kicker + title)
// but reclaims the vertical room for the stats and action-needed
// blocks below. The dynamic summary line ("3 wallets · 2 need your
// approval") gives a returning user a useful one-line status before
// any cards have rendered.

function Hero({
  walletCount,
  pendingCount,
  loading,
  reduce,
}: {
  walletCount: number;
  pendingCount: number;
  loading: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const summary = (() => {
    if (loading) return "Loading your wallets…";
    if (walletCount === 0) return "Start a shared wallet to get going.";
    const w = `${walletCount} ${walletCount === 1 ? "wallet" : "wallets"}`;
    if (pendingCount === 0) return `${w} · all caught up`;
    const p = `${pendingCount} ${pendingCount === 1 ? "needs" : "need"} your approval`;
    return `${w} · ${p}`;
  })();

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1"
    >
      {/* Mobile shows "Welcome back" in the floating header pill, so
          the page H1 only renders on md+ to avoid repeating the same
          greeting in two places. */}
      <h1 className="hidden font-display text-display-xs leading-tight text-text-strong md:block">
        Welcome back
      </h1>
      <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
    </motion.div>
  );
}

// ─── Stats row ─────────────────────────────────────────────────────
//
// Three at-a-glance metrics: total balance (sum of Solana vault
// lamports across all member wallets), wallet count, and pending
// approvals. The approvals card flips to an accent border + accent
// numerals when > 0 so the eye lands there first. Reuses the same
// balancesQuery the wallet grid feeds off - no extra RPC.

function StatsRow({
  wallets,
  balances,
  loadingBalances,
  pendingCount,
  reduce,
}: {
  wallets: OnchainMembership[];
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  pendingCount: number;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const totalLamports = useMemo(() => {
    if (!balances) return 0;
    let sum = 0;
    for (const m of wallets) sum += balances.get(m.wallet) ?? 0;
    return sum;
  }, [wallets, balances]);

  const totalBalance = formatBalance(totalLamports);
  const balanceLoading = loadingBalances && balances === undefined;

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-3"
    >
      <BalanceHeroCard
        amount={totalBalance.amount}
        unit={totalBalance.ticker}
        totalLamports={totalLamports}
        walletCount={wallets.length}
        loading={balanceLoading}
      />
      {/* Secondary stats - Wallets count and pending-approval bell.
          Side-by-side on every viewport so the two metrics carry
          equal visual weight under the hero. */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          Icon={Users}
          label="Wallets"
          value={String(wallets.length)}
        />
        <StatCard
          Icon={Bell}
          label="Need approval"
          value={String(pendingCount)}
          accent={pendingCount > 0}
        />
      </div>
    </motion.div>
  );
}

function NextActionStrip({
  wallet,
  pendingCount,
  firstApprovalHref,
  reduce,
}: {
  wallet: OnchainMembership;
  pendingCount: number;
  firstApprovalHref: string | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const walletName = wallet.wallet_name ?? "Wallet";
  const displayName = toDisplayName(walletName);
  const encoded = encodeURIComponent(walletName);
  const primaryHref =
    pendingCount > 0 && firstApprovalHref
      ? firstApprovalHref
      : `/app/wallet/${encoded}`;
  const primaryLabel = pendingCount > 0 ? "Review approvals" : "Open wallet";
  const summary =
    pendingCount > 0
      ? `${pendingCount} ${pendingCount === 1 ? "approval needs" : "approvals need"} your decision.`
      : `Continue with ${displayName} or start another shared wallet.`;

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-text-soft">
            Next step
          </p>
          <p className="mt-1 truncate text-sm font-medium text-text-strong">
            {displayName}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">{summary}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Link href={primaryHref}>
            <Button size="md">
              {primaryLabel}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
          <Link
            href="/app/wallet/new"
            className="inline-flex min-h-tap items-center rounded-full px-3 text-xs font-medium text-text-soft transition-colors hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            New wallet
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

// ─── Balance hero card ─────────────────────────────────────────────
//
// Lead card on Home - total SOL balance across every wallet the
// member belongs to. Treated like a premium debit-card surface:
//   • A subtle accent gradient washes the panel (top-left → bottom-right)
//   • A grid of large, very-low-opacity BrandMark icons sits behind
//     the content as a watermark - ties the card to the product
//     identity without competing with the number
//   • A small visible BrandMark badge in the top-left anchors the
//     "this is yours, on Clear" cue
//   • Numerals are oversized (text-4xl / sm:text-5xl) so the balance
//     reads as the page's primary number
//
// All decoration is `pointer-events-none` so taps and selections
// always fall through to the actual content.

function BalanceHeroCard({
  amount,
  unit,
  totalLamports,
  walletCount,
  loading,
}: {
  amount: string;
  unit: string;
  totalLamports: number;
  walletCount: number;
  loading: boolean;
}) {
  return (
    <section
      className={clsx(
        "relative overflow-hidden rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest sm:p-7",
      )}
    >
      {/* Accent gradient wash - soft top-right glow that anchors the
          card to the brand palette without overwhelming. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-100"
        style={{
          background:
            "radial-gradient(circle at 100% 0%, rgba(204, 255, 0,0.08) 0%, rgba(204, 255, 0,0) 55%)",
        }}
      />

      {/* Watermark grid - repeated BrandMark at very low opacity,
          rotated and scattered. Gives the card a "stamped on the
          back of a credit card" feel that elevates it beyond a
          plain stat tile. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden text-accent"
      >
        {WATERMARK_GRID.map((mark) => (
          <div
            key={`${mark.top}-${mark.left}`}
            className="absolute opacity-[0.045]"
            style={{
              top: mark.top,
              left: mark.left,
              transform: `rotate(${mark.rotate}deg)`,
            }}
          >
            <BrandMark size={mark.size} />
          </div>
        ))}
      </div>

      {/* Foreground content. relative + z-10 keeps it above both
          decoration layers. */}
      <div className="relative z-10">
        {/* Brand row - small visible mark + label */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15">
              <BrandMark size={14} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Total balance
            </span>
          </div>
          {!loading && (
            <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-soft/70">
              {walletCount === 0
                ? "-"
                : walletCount === 1
                  ? "1 wallet"
                  : `${walletCount} wallets`}
            </span>
          )}
        </div>

        {/* Big numerals */}
        {loading ? (
          <div className="mt-5 h-12 w-44 animate-pulse rounded bg-border-soft/80 sm:h-14 sm:w-56" />
        ) : (
          <>
            <p className="mt-5 flex items-baseline gap-2">
              <span className="font-numerals text-4xl font-semibold leading-none tracking-tight text-text-strong tabular-nums sm:text-5xl">
                {amount}
              </span>
              <span className="font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft sm:text-lg">
                {unit}
              </span>
            </p>
            <p className="mt-2 text-xs text-text-soft sm:text-sm">
              <UsdHint
                amount={BigInt(Math.round(totalLamports))}
                smallestPerWhole={1_000_000_000n}
                ticker="SOL"
                variant="plain"
                className="font-numerals tabular-nums"
              />
            </p>
          </>
        )}

        {/* Bottom hairline + brand caption - credit-card style.
            Subtle, but ties the watermark grid to a clear "Clear"
            attribution. */}
        <div className="mt-6 flex items-center gap-2">
          <span aria-hidden="true" className="block h-px w-8 bg-accent/60" />
          <span className="text-[10px] font-medium uppercase tracking-[0.28em] text-text-soft/70">
            Clear · shared treasury
          </span>
        </div>
      </div>
    </section>
  );
}

// Pre-computed scatter pattern for the watermark grid. Hand-tuned
// positions + sizes + rotations so the marks read as a designed
// pattern rather than random clutter. Static module-level array so
// the layout is stable across renders (no jitter).
const WATERMARK_GRID: {
  top: string;
  left: string;
  size: number;
  rotate: number;
}[] = [
  { top: "-8px", left: "12%", size: 40, rotate: -12 },
  { top: "20%", left: "62%", size: 32, rotate: 18 },
  { top: "40%", left: "8%", size: 36, rotate: 24 },
  { top: "55%", left: "78%", size: 48, rotate: -8 },
  { top: "70%", left: "32%", size: 40, rotate: 14 },
  { top: "85%", left: "58%", size: 28, rotate: -22 },
  { top: "8%", left: "85%", size: 26, rotate: 6 },
];

function StatCard({
  Icon,
  label,
  value,
  unit,
  loading,
  accent,
}: {
  Icon: typeof Wallet;
  label: string;
  value: string;
  unit?: string;
  loading?: boolean;
  accent?: boolean;
}) {
  return (
    <div
      className={clsx(
        "rounded-card border bg-surface-raised p-4 shadow-card-rest",
        "transition-[border-color,box-shadow] duration-base ease-out-soft",
        accent ? "border-accent/40" : "border-border-soft",
      )}
    >
      <div className="flex items-center gap-2 text-text-soft">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
          {label}
        </span>
      </div>
      {loading ? (
        <div className="mt-2.5 h-7 w-24 animate-pulse rounded bg-border-soft/80" />
      ) : (
        <p className="mt-1.5 flex items-baseline gap-1.5">
          <span
            className={clsx(
              "font-numerals text-2xl font-semibold tabular-nums leading-tight",
              accent ? "text-accent" : "text-text-strong",
            )}
          >
            {value}
          </span>
          {unit && (
            <span className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-text-soft">
              {unit}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

// ─── Memberships error state ───────────────────────────────────────
//
// When the on-chain memberships fetch fails (RPC blip, connection
// dropped mid-load), we used to render the first-visit CTA which
// tells the user to "Create your first wallet" - for someone who
// already has wallets, that's a dangerous nudge. This card replaces
// the silent fallback with an explicit retry.

function MembershipsErrorCard({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-card border border-warning/30 bg-warning/[0.06] p-6 shadow-card-rest">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-warning">
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
        <Link href="/app/wallet/new">
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
              // Cap the stagger at 4 so the last card paints in
              // 80ms regardless of wallet count. Treasury users
              // with 6+ wallets used to see 240ms+ of cascade,
              // which read as jank on slow networks.
              delay={Math.min(i, 4) * 0.02}
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
      className="group/card relative"
    >
      <Link
        href={`/app/wallet/${encodeURIComponent(onChainName)}`}
        className={
          "group relative flex flex-col gap-3 rounded-card border bg-surface-raised p-5 shadow-card-rest " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
          (pinned ? "border-accent/40" : "border-border-soft")
        }
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {/* The pinned-state Pin icon used to also render inline
                next to the name. With the corner pin button in
                place (accent border + Pin icon when pinned) the
                inline copy was duplicate chrome - both icons
                visible, neither carrying signal the other didn't.
                Keep only the corner button. */}
            <p className="font-display text-xl text-text-strong">
              <span className="truncate">{name}</span>
            </p>
            {loadingBalance && balance === null ? (
              <div className="mt-1 h-5 w-20 animate-pulse rounded bg-border-soft" />
            ) : (
              // Editorial-sans: JetBrains Mono numerals for the
              // balance value, Manrope display caps for the ticker.
              // Same currency-code treatment as /send/* and Hero
              // single-chain balance - one shared pattern app-wide.
              <p className="mt-1 flex items-baseline gap-1.5">
                <span className="font-numerals text-base font-semibold text-text-strong tabular-nums">
                  {balance ? balance.amount : "0"}
                </span>
                <span className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-text-soft">
                  {balance?.ticker ?? "SOL"}
                </span>
                {balanceLamports !== null && balanceLamports > 0 && (
                  <UsdHint
                    amount={BigInt(Math.round(balanceLamports))}
                    smallestPerWhole={1_000_000_000n}
                    ticker="SOL"
                    className="text-[11px] text-text-soft tabular-nums"
                  />
                )}
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
          // Anchored to the bottom-right corner so it doesn't fight the
          // navigation arrow in the top-right of the card header. The
          // pending-approval pill is self-start (bottom-LEFT), so this
          // sits opposite it on the same baseline - reads as a balanced
          // corner control rather than chrome stacked on chrome.
          // Tap target is h-tap w-tap (44px) when pinned for mobile
          // touch; desktop hover state still rendered fine on the
          // smaller 28px hit-area, but mobile users couldn't reach
          // it reliably.
          "absolute bottom-3 right-3 items-center justify-center rounded-full border bg-surface-raised " +
          "transition-[color,border-color,transform,opacity] duration-base ease-out-soft " +
          (pinned
            ? // Pinned cards always show the icon (status signal).
              // Accent border so it reads as "this is intentionally
              // here", not chrome. Full tap target for mobile.
              "inline-flex h-tap w-tap border-accent/40 text-accent"
            : // Unpinned: hide on mobile (pin/unpin is rarely a
              // touch-first action and the icon read as clutter on
              // every card). Desktop reveals it on card hover so the
              // resting state stays clean.
              "hidden h-7 w-7 border-border-soft text-text-soft/60 opacity-0 group-hover/card:opacity-100 hover:text-accent md:inline-flex") +
          " focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
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
// was 110px tall and had two short stripes - real cards land at
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
          {/* Title line - same width as font-display text-xl. */}
          <div className="h-6 w-1/2 animate-pulse rounded bg-border-soft" />
          {/* Balance line - slightly tighter than the title. */}
          <div className="mt-2.5 h-5 w-24 animate-pulse rounded bg-border-soft/80" />
        </div>
        {/* Pin button placeholder - keeps the right edge stable. */}
        <div className="h-7 w-7 shrink-0 animate-pulse rounded-full bg-border-soft/60" />
      </div>
      {/* Pending-approval pill - most loaded cards have at least
          one badge slot worth of vertical space. Quieter pulse so
          it doesn't read as required. */}
      <div className="mt-4 h-6 w-32 animate-pulse rounded-full bg-border-soft/40" />
    </div>
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
            "hover:-translate-y-0.5 hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
          title="See every request across all wallets, with filters and CSV export"
        >
          See more
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
        {rows.slice(0, 4).map((row) => (
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
          "transition-colors duration-base ease-out-soft hover:bg-canvas " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
        }
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-strong">
            {toDisplayName(row.walletName)}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            <span className={statusTextColor(row.status)}>{friendlyStatus(row.status, row.intentTemplate)}</span>
            <span aria-hidden="true" className="mx-1.5 text-text-soft">·</span>
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
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
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
            "hover:-translate-y-0.5 hover:text-accent " +
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
                "rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-text-on-accent " +
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
                            {pending} active request
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
