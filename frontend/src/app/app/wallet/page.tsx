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

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  Activity,
  ArrowRight,
  Bell,
  Bot,
  Building2,
  ChevronLeft,
  Eye,
  EyeOff,
  Layers,
  KeyRound,
  Plus,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  sortPinnedFirst,
  subscribePinnedWallets,
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
import {
  activityGroupTitle,
  groupRecentActivityRows,
  type RecentActivityGroup,
} from "@/lib/retail/activityGroups";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Button } from "@/components/retail/Button";
import { BrandMark } from "@/components/retail/BrandMark";
import { BalanceCardPattern } from "@/components/retail/BalanceCardPattern";
import { relativeTime } from "@/lib/util/relativeTime";
import {
  friendlyIntentLabel,
  friendlyStatus,
  statusTextColor,
} from "@/lib/retail/labels";
import { proposerDisplayName } from "@/lib/retail/proposerName";
import { formatBalance } from "@/lib/retail/format";
import { formatChainBalance } from "@/lib/balances";
import { toDisplayName } from "@/lib/retail/walletNames";
import { UnsupportedSignerBanner } from "@/components/retail/UnsupportedSignerBanner";
import { UsdHint } from "@/components/retail/UsdHint";
import {
  useWalletPortfolio,
  type WalletPortfolio,
} from "@/lib/hooks/useWalletPortfolio";
import { chainByKind, chainDisplayRank } from "@/lib/retail/chains";
import { useDisplayCurrency } from "@/lib/hooks/useDisplayCurrency";
import {
  filterWalletsByProductSurface,
  productWorkspaceHomeHref,
  productWorkspaceLabel,
  resolveWalletProductSurface,
  type WalletProductSurface,
  walletProductSurface,
} from "@/lib/productWorkspace";
import {
  isProductSurfaceId,
  productSetupHref,
  productSurfaceById,
} from "@/lib/productSurfaces";
import {
  clearPendingProductSurface,
  readPendingProductSurface,
  readSelectedProductSurface,
  saveSelectedProductSurface,
} from "@/lib/productSession";
import { useBalancePrivacy } from "@/lib/hooks/useBalancePrivacy";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";

export default function WalletDashboard() {
  return (
    <Suspense fallback={<WalletDashboardShell />}>
      <WalletDashboardContent />
    </Suspense>
  );
}

function WalletDashboardContent() {
  const wallet = useWallet();
  const { connection } = useConnection();
  const search = useSearchParams();
  const address = wallet.publicKey?.toBase58() ?? "";
  const reduce = useReducedMotion();
  const requested = search.get("surface");
  const requestedAll = requested === "all";
  const requestedSurface = walletProductSurface(
    isProductSurfaceId(requested) ? requested : null,
  );
  const [storedSurface, setStoredSurface] =
    useState<WalletProductSurface | null>(null);
  const [activeSurface, setActiveSurface] =
    useState<WalletProductSurface | null>(null);

  useEffect(() => {
    setStoredSurface(walletProductSurface(readSelectedProductSurface(address)));
  }, [address]);

  useEffect(() => {
    const pendingSurface = walletProductSurface(readPendingProductSurface());
    if (!pendingSurface) return;
    saveSelectedProductSurface(pendingSurface, address);
    clearPendingProductSurface();
    setStoredSurface(pendingSurface);
    setActiveSurface(pendingSurface);
    if (typeof window !== "undefined" && !requestedSurface && !requestedAll) {
      window.history.replaceState(
        null,
        "",
        `/app/wallet?surface=${pendingSurface}`,
      );
    }
  }, [address, requestedAll, requestedSurface]);

  useEffect(() => {
    setActiveSurface(requestedAll ? null : requestedSurface ?? storedSurface);
  }, [requestedAll, requestedSurface, storedSurface]);

  useEffect(() => {
    if (!requestedSurface) return;
    saveSelectedProductSurface(requestedSurface, address);
    setStoredSurface(requestedSurface);
  }, [requestedSurface, address]);

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  const action = useActionNeeded();
  const recent = action.activity;
  const watched = useWatchedWallets();

  const [walletCacheByAddress, setWalletCacheByAddress] = useState<
    Map<string, OnchainMembership[]>
  >(() => new Map());
  useEffect(() => {
    if (!address || memberships.data === undefined) return;
    setWalletCacheByAddress((previous) => {
      const cached = previous.get(address);
      if (cached === memberships.data) return previous;
      const next = new Map(previous);
      next.set(address, memberships.data);
      return next;
    });
  }, [address, memberships.data]);
  const cachedWallets = useMemo(
    () => (address ? walletCacheByAddress.get(address) ?? [] : []),
    [address, walletCacheByAddress],
  );
  const wallets = useMemo(
    () => memberships.data ?? cachedWallets,
    [cachedWallets, memberships.data],
  );
  const showingCachedWallets =
    memberships.data === undefined && cachedWallets.length > 0;
  const selectedSurface = activeSurface;
  const displaySurface = selectedSurface;
  const visibleWallets = useMemo(() => {
    return filterWalletsByProductSurface(wallets, displaySurface);
  }, [wallets, displaySurface]);
  const visibleWalletPdas = useMemo(
    () => new Set(visibleWallets.map((membership) => membership.wallet)),
    [visibleWallets],
  );
  const visibleWalletNames = useMemo(
    () =>
      new Set(
        visibleWallets
          .map((membership) => membership.wallet_name)
          .filter((name): name is string => Boolean(name)),
      ),
    [visibleWallets],
  );
  const stillLoading = memberships.isLoading && !showingCachedWallets;
  // Distinguish "RPC errored" from "user genuinely has no wallets."
  // Without this guard, a transient memberships failure renders the
  // first-visit CTA - which then sends the user through /welcome to
  // create a duplicate wallet.
  const hasError = !stillLoading && memberships.isError && wallets.length === 0;
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

  const filteredActionRows = useMemo(
    () =>
      displaySurface
        ? action.rows.filter((row) => visibleWalletNames.has(row.walletName))
        : action.rows,
    [action.rows, displaySurface, visibleWalletNames],
  );
  const filteredRecentRows = useMemo(
    () =>
      displaySurface
        ? recent.rows.filter((row) => visibleWalletPdas.has(row.walletPda))
        : recent.rows,
    [recent.rows, displaySurface, visibleWalletPdas],
  );
  const visiblePendingByWallet = useMemo(() => {
    if (!displaySurface) return recent.pendingByWallet;
    const next = new Map<string, number>();
    for (const membership of visibleWallets) {
      const count = recent.pendingByWallet.get(membership.wallet) ?? 0;
      if (count > 0) next.set(membership.wallet, count);
    }
    return next;
  }, [recent.pendingByWallet, displaySurface, visibleWallets]);
  const filteredPendingCount = filteredActionRows.length;

  const showStats =
    !hasError &&
    !isFirstVisit &&
    (visibleWallets.length > 0 || stillLoading);
  const showRecent =
    !isFirstVisit && (filteredRecentRows.length > 0 || action.loading);
  const showWatched = !hasError && displaySurface === null;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <UnsupportedSignerBanner />

      {/* Compact hero - left-aligned title + dynamic summary line.
          Replaces the centered "Welcome back" block; gives back the
          vertical real estate to actionable content below. */}
      <Hero
        walletCount={visibleWallets.length}
        pendingCount={filteredPendingCount}
        selectedSurface={displaySurface}
        loading={stillLoading}
        reduce={!!reduce}
      />

      {showStats && (
        <StatsRow
          visibleWallets={visibleWallets}
          switcherWallets={wallets}
          balances={balancesQuery.data}
          loadingBalances={balancesQuery.isLoading}
          loadingWallets={stillLoading}
          pendingByWallet={visiblePendingByWallet}
          switcherPendingByWallet={recent.pendingByWallet}
          pendingCount={filteredPendingCount}
          pendingLoading={action.loading}
          selectedSurface={displaySurface}
          primaryWallet={visibleWallets[0] ?? null}
          reduce={!!reduce}
        />
      )}

      {hasError ? (
        <MembershipsErrorCard onRetry={() => memberships.refetch()} />
      ) : isFirstVisit && watched.rows.length === 0 ? (
        <FirstVisitCard selectedSurface={displaySurface} />
      ) : displaySurface && visibleWallets.length === 0 && !stillLoading ? (
        <ProductEmptyState selectedSurface={displaySurface} />
      ) : (
        null
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
              <RecentActivitySection
                rows={filteredRecentRows}
                loading={action.loading}
                reduce={!!reduce}
              />
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

function WalletDashboardShell() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="hidden h-10 w-52 rounded-full border border-border-soft bg-surface-raised md:block" />
        <div className="h-4 w-36 rounded-full bg-border-soft/70" />
      </div>
      <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="h-11 rounded-soft border border-border-soft bg-canvas/60"
            />
          ))}
        </div>
      </div>
      <div className="relative h-52 overflow-hidden rounded-card border border-border-soft bg-[#090908] p-4 shadow-card-rest">
        <div className="absolute inset-x-8 top-3 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
        <div className="flex h-full items-center justify-center rounded-[1.1rem] border border-white/[0.08] bg-[radial-gradient(circle_at_50%_0%,rgba(204,255,0,0.08),transparent_42%),linear-gradient(180deg,#151511,#090909)]">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border border-accent/25 bg-accent/[0.07]">
            <BrandMark size={36} />
          </div>
        </div>
      </div>
    </div>
  );
}

// â”€â”€â”€ Hero â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Compact left-aligned page header. Replaces the previous centered
// "Welcome back" block - same identity cue (small kicker + title)
// but reclaims the vertical room for the stats and action-needed
// blocks below. The dynamic summary line ("3 wallets - 2 need your
// approval") gives a returning user a useful one-line status before
// any cards have rendered.

function Hero({
  walletCount,
  pendingCount,
  selectedSurface,
  loading,
  reduce,
}: {
  walletCount: number;
  pendingCount: number;
  selectedSurface: WalletProductSurface | null;
  loading: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const summary = (() => {
    if (loading) return "Loading your wallets...";
    if (selectedSurface && walletCount === 0) {
      return `No ${productWorkspaceLabel(selectedSurface).toLowerCase()} yet.`;
    }
    if (walletCount === 0) return "Choose a product to get going.";
    const noun = selectedSurface
      ? productWorkspaceLabel(selectedSurface).toLowerCase()
      : "wallet";
    const w = `${walletCount} ${walletCount === 1 ? noun : `${noun}s`}`;
    if (pendingCount === 0) return `${w} - all caught up`;
    const p = `${pendingCount} ${pendingCount === 1 ? "needs" : "need"} your approval`;
    return `${w} - ${p}`;
  })();
  const title = selectedSurface
    ? productWorkspaceLabel(selectedSurface)
    : "Product workspaces";

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="hidden flex-wrap items-end justify-between gap-x-4 gap-y-3 md:flex"
    >
      <div className="min-w-0">
        <h1 className="hidden font-display text-display-xs leading-tight text-text-strong md:block">
          {title}
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
      </div>
    </motion.div>
  );
}

// â”€â”€â”€ Stats row â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Three at-a-glance metrics: total balance (sum of Solana vault
// lamports across all member wallets), wallet count, and pending
// approvals. The approvals card flips to an accent border + accent
// numerals when > 0 so the eye lands there first. Reuses the same
// balancesQuery the wallet grid feeds off - no extra RPC.

function StatsRow({
  visibleWallets,
  switcherWallets,
  balances,
  loadingBalances,
  loadingWallets,
  pendingByWallet,
  switcherPendingByWallet,
  pendingCount,
  pendingLoading,
  selectedSurface,
  primaryWallet,
  reduce,
}: {
  visibleWallets: OnchainMembership[];
  switcherWallets: OnchainMembership[];
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  loadingWallets: boolean;
  pendingByWallet: Map<string, number>;
  switcherPendingByWallet: Map<string, number>;
  pendingCount: number;
  pendingLoading: boolean;
  selectedSurface: WalletProductSurface | null;
  primaryWallet: OnchainMembership | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const [portfolioByWallet, setPortfolioByWallet] = useState<
    Map<string, PortfolioSnapshot>
  >(() => new Map());
  const [walletSwitcherOpen, setWalletSwitcherOpen] = useState(false);
  const visibleWalletNames = useMemo(
    () =>
      visibleWallets
        .map((wallet) => wallet.wallet_name)
        .filter((name): name is string => Boolean(name)),
    [visibleWallets],
  );
  const visibleWalletNameKey = visibleWalletNames.join("|");

  useEffect(() => {
    const visible = new Set(visibleWalletNames);
    setPortfolioByWallet((prev) => {
      let changed = false;
      const next = new Map<string, PortfolioSnapshot>();
      prev.forEach((snapshot, name) => {
        if (visible.has(name)) {
          next.set(name, snapshot);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [visibleWalletNames, visibleWalletNameKey]);

  const handlePortfolioChange = useCallback(
    (walletName: string, snapshot: PortfolioSnapshot | null) => {
      setPortfolioByWallet((prev) => {
        const next = new Map(prev);
        if (snapshot) {
          next.set(walletName, snapshot);
        } else {
          next.delete(walletName);
        }
        return next;
      });
    },
    [],
  );

  const totalLamports = useMemo(() => {
    if (!balances) return 0;
    let sum = 0;
    for (const m of visibleWallets) sum += balances.get(m.wallet) ?? 0;
    return sum;
  }, [visibleWallets, balances]);

  const aggregate = useMemo(
    () => aggregatePortfolio(Array.from(portfolioByWallet.values())),
    [portfolioByWallet],
  );
  const totalBalance = formatBalance(totalLamports);
  const balanceLoading =
    loadingWallets ||
    (loadingBalances && balances === undefined) ||
    visibleWalletNames.some(
      (name) =>
        !portfolioByWallet.has(name) || portfolioByWallet.get(name)?.isLoading,
    );

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-2.5 sm:gap-3"
    >
      <div aria-hidden="true" className="hidden">
        {visibleWalletNames.map((walletName) => (
          <WalletPortfolioReporter
            key={walletName}
            walletName={walletName}
            onChange={handlePortfolioChange}
          />
        ))}
      </div>
      <BalanceHeroCard
        amount={totalBalance.amount}
        unit={totalBalance.ticker}
        totalLamports={totalLamports}
        aggregate={aggregate}
        walletCount={visibleWallets.length}
        selectedSurface={selectedSurface}
        balanceLoading={balanceLoading}
        walletCountLoading={loadingWallets}
        primaryWallet={primaryWallet}
        onOpenWalletSwitcher={() => setWalletSwitcherOpen(true)}
      />
      <MobileWalletSwitchModal
        open={walletSwitcherOpen}
        wallets={switcherWallets}
        balances={balances}
        loadingBalances={loadingBalances}
        pendingByWallet={switcherPendingByWallet}
        onClose={() => setWalletSwitcherOpen(false)}
      />
      {pendingCount > 0 || pendingLoading ? (
        <div className="grid grid-cols-1 gap-2.5 sm:gap-3">
          <StatCard
            Icon={Bell}
            label="Need approval"
            value={String(pendingCount)}
            loading={pendingLoading}
            accent={pendingCount > 0}
          />
        </div>
      ) : null}
    </motion.div>
  );
}

type PortfolioSnapshot = Pick<
  WalletPortfolio,
  "breakdown" | "totalUsd" | "isLoading"
>;

interface AggregateChainBalance {
  kind: number;
  ticker: string;
  amount: string;
  raw: bigint;
}

interface AggregatePortfolio {
  totalUsd: number;
  chains: AggregateChainBalance[];
}

function WalletPortfolioReporter({
  walletName,
  onChange,
}: {
  walletName: string;
  onChange: (walletName: string, snapshot: PortfolioSnapshot | null) => void;
}) {
  const portfolio = useWalletPortfolio(walletName);
  useEffect(() => {
    onChange(walletName, {
      breakdown: portfolio.breakdown,
      totalUsd: portfolio.totalUsd,
      isLoading: portfolio.isLoading,
    });
    return () => onChange(walletName, null);
  }, [
    walletName,
    portfolio.breakdown,
    portfolio.totalUsd,
    portfolio.isLoading,
    onChange,
  ]);
  return null;
}

function aggregatePortfolio(snapshots: PortfolioSnapshot[]): AggregatePortfolio {
  const byKind = new Map<number, { raw: bigint; ticker: string }>();
  let totalUsd = 0;
  for (const snapshot of snapshots) {
    totalUsd += snapshot.totalUsd;
    for (const chain of snapshot.breakdown) {
      if (chain.raw === null || chain.raw === 0n) continue;
      const existing = byKind.get(chain.kind);
      byKind.set(chain.kind, {
        raw: (existing?.raw ?? 0n) + chain.raw,
        ticker: existing?.ticker ?? chain.ticker,
      });
    }
  }
  const chains = Array.from(byKind.entries())
    .sort(([a], [b]) => chainDisplayRank(a) - chainDisplayRank(b))
    .map(([kind, value]) => {
      const meta = chainByKind(kind);
      const amount = meta
        ? formatChainBalance(
            value.raw,
            meta.smallestPerWhole,
            meta.displayDecimals,
          )
        : value.raw.toString();
      return {
        kind,
        ticker: meta?.ticker ?? value.ticker,
        amount: amount ?? "0",
        raw: value.raw,
      };
    });
  return { totalUsd, chains };
}

function NextActionStrip({
  wallet,
  pendingCount,
  firstApprovalHref,
  selectedSurface,
  reduce,
}: {
  wallet: OnchainMembership;
  pendingCount: number;
  firstApprovalHref: string | null;
  selectedSurface: WalletProductSurface | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const walletName = wallet.wallet_name ?? "Wallet";
  const displayName = toDisplayName(walletName);
  const surface = resolveWalletProductSurface(walletName);
  const primaryHref =
    pendingCount > 0 && firstApprovalHref
      ? firstApprovalHref
      : productWorkspaceHomeHref(walletName, surface);
  const primaryLabel = pendingCount > 0 ? "Review approvals" : "Open wallet";
  const summary =
    pendingCount > 0
      ? `${pendingCount} ${pendingCount === 1 ? "approval needs" : "approvals need"} your decision.`
      : selectedSurface
        ? `Continue with ${displayName} or create another ${productWorkspaceLabel(selectedSurface).toLowerCase()}.`
        : `Continue with ${displayName} or choose another product.`;
  const createHref = selectedSurface
    ? productSetupHref(selectedSurface)
    : "/choose";
  const createLabel = selectedSurface ? "New" : "Choose product";

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
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
            href={createHref}
            className="inline-flex min-h-tap items-center rounded-full px-3 text-xs font-medium text-text-soft transition-colors hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {createLabel}
          </Link>
        </div>
      </div>
    </motion.section>
  );
}

// â”€â”€â”€ Balance hero card â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Lead card on Home - total value across every visible wallet the
// member belongs to. Treated like a premium debit-card surface:
//   â€¢ A subtle accent gradient washes the panel (top-left â†’ bottom-right)
//   â€¢ A small visible BrandMark badge in the top-left anchors the
//     "this is yours, on Clear" cue
//   â€¢ Numerals are oversized (text-4xl / sm:text-5xl) so the balance
//     reads as the page's primary number
//
// All decoration is `pointer-events-none` so taps and selections
// always fall through to the actual content.

function BalanceHeroCard({
  amount,
  unit,
  totalLamports,
  aggregate,
  walletCount,
  selectedSurface,
  balanceLoading,
  walletCountLoading,
  primaryWallet,
  onOpenWalletSwitcher,
}: {
  amount: string;
  unit: string;
  totalLamports: number;
  aggregate: AggregatePortfolio;
  walletCount: number;
  selectedSurface: WalletProductSurface | null;
  balanceLoading: boolean;
  walletCountLoading: boolean;
  primaryWallet: OnchainMembership | null;
  onOpenWalletSwitcher?: () => void;
}) {
  const label = selectedSurface
    ? productWorkspaceLabel(selectedSurface)
    : "Total balance";
  const surfaceCopy = productDashboardCopy(selectedSurface);
  const { hidden, toggle } = useBalancePrivacy();
  const fiat = useDisplayCurrency();
  const hiddenClass = hidden ? "blur-sm select-none" : "";
  const hasPortfolioTotal = aggregate.chains.length > 0;
  const headline = hasPortfolioTotal ? fiat.format(aggregate.totalUsd) : amount;
  const primaryWalletName = primaryWallet?.wallet_name ?? null;
  const primaryWalletSurface = primaryWalletName
    ? resolveWalletProductSurface(primaryWalletName, selectedSurface)
    : selectedSurface;
  const primaryWorkspaceHref = primaryWalletName
    ? productWorkspaceHomeHref(primaryWalletName, primaryWalletSurface)
    : selectedSurface
      ? productSetupHref(selectedSurface)
      : "/choose";
  const primaryActionLabel = primaryWalletName
    ? productOpenLabel(selectedSurface)
    : selectedSurface
      ? `Create ${productSurfaceById(selectedSurface).shortName}`
      : "Choose product";
  return (
    <section
      className={clsx(
        "relative min-h-[10.75rem] overflow-hidden rounded-card border p-4 shadow-card-rest md:min-h-0 md:p-5",
        selectedSurface
          ? surfaceHeroTone(selectedSurface)
          : "border-border-soft bg-surface-raised",
      )}
    >
      {/* Foreground content. relative + z-10 keeps it above both
          decoration layers. */}
      <div className="relative z-10 grid gap-4 md:gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center lg:gap-5">
        <div className="min-w-0">
        {/* Brand row - small visible mark + label */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/10">
              {selectedSurface ? (
                <surfaceCopy.Icon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              ) : (
                <BrandMark size={12} />
              )}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {label}
            </span>
          </div>
          {(!balanceLoading ||
            walletCountLoading ||
            (onOpenWalletSwitcher && walletCount > 0)) && (
            <div className="hidden items-center gap-2 md:flex">
              {walletCountLoading ? (
                <Shimmer className="h-3.5 w-16 rounded-full" />
              ) : (
                <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-soft/70">
                  {walletCount === 0
                    ? "-"
                    : selectedSurface
                      ? walletCount === 1
                        ? "1 workspace"
                        : `${walletCount} workspaces`
                      : walletCount === 1
                        ? "1 wallet"
                        : `${walletCount} wallets`}
                </span>
              )}
              {onOpenWalletSwitcher && walletCount > 0 ? (
                <button
                  type="button"
                  onClick={onOpenWalletSwitcher}
                  className="inline-flex h-8 items-center justify-center rounded-full bg-accent px-3 text-[11px] font-semibold text-text-on-accent shadow-accent-rest transition-[background-color,transform,box-shadow] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  Switch
                </button>
              ) : null}
              {!balanceLoading ? (
                <button
                  type="button"
                  onClick={toggle}
                  aria-label={hidden ? "Show balances" : "Hide balances"}
                  title={hidden ? "Show balances" : "Hide balances"}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-soft bg-canvas/60 text-text-soft transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                >
                  {hidden ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </div>
          )}
          {!balanceLoading ? (
            <button
              type="button"
              onClick={toggle}
              aria-label={hidden ? "Show balances" : "Hide balances"}
              title={hidden ? "Show balances" : "Hide balances"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border-soft bg-canvas/70 text-text-soft transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised md:hidden"
            >
              {hidden ? (
                <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>
          ) : null}
        </div>

        {selectedSurface ? (
          <div className="mt-3 max-w-2xl sm:mt-4">
            <h2 className="font-display text-xl font-semibold leading-tight text-text-strong sm:text-2xl">
              {surfaceCopy.title}
            </h2>
            <p className="mt-1 hidden text-sm leading-relaxed text-text-soft sm:block">
              {surfaceCopy.body}
            </p>
          </div>
        ) : null}

        {/* Big numerals */}
        {balanceLoading ? (
          <Shimmer className="mt-2 h-10 w-40 rounded md:mt-5 md:h-12 md:w-52" />
        ) : (
          <>
            <p className={clsx("mt-2 flex items-baseline gap-2 transition-[filter] duration-base md:mt-5", hiddenClass)}>
              <span className="font-numerals text-[2.15rem] font-semibold leading-none text-text-strong tabular-nums md:text-4xl">
                {headline}
              </span>
              {!hasPortfolioTotal ? (
                <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-text-soft md:text-base">
                  {unit}
                </span>
              ) : null}
            </p>
            {!hasPortfolioTotal ? (
              <p className={clsx("mt-1.5 text-xs text-text-soft transition-[filter] duration-base md:text-sm", hiddenClass)}>
                <UsdHint
                  amount={BigInt(Math.round(totalLamports))}
                  smallestPerWhole={1_000_000_000n}
                  ticker="SOL"
                  variant="plain"
                  className="font-numerals tabular-nums"
                />
              </p>
            ) : null}
          </>
        )}

        {!selectedSurface ? (
          <div className="mt-4 flex items-center justify-between gap-3 md:hidden">
            {walletCountLoading ? (
              <Shimmer className="h-8 w-24 rounded-full" />
            ) : (
              <span className="inline-flex h-8 items-center rounded-full bg-canvas/70 px-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
                {walletCount === 0
                  ? "No wallets"
                  : walletCount === 1
                    ? "1 wallet"
                    : `${walletCount} wallets`}
              </span>
            )}
            {onOpenWalletSwitcher && !walletCountLoading && walletCount > 0 ? (
              <button
                type="button"
                onClick={onOpenWalletSwitcher}
                className="inline-flex h-9 items-center justify-center rounded-full bg-accent px-4 text-[11px] font-semibold text-text-on-accent shadow-accent-rest transition-[background-color,transform,box-shadow] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              >
                Switch
              </button>
            ) : null}
          </div>
        ) : null}

        {selectedSurface ? (
          <div className="mt-4 flex items-center justify-between gap-3 sm:mt-5">
          <p className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft sm:text-[11px]">
            {surfaceCopy.footer}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            {onOpenWalletSwitcher && walletCount > 0 ? (
              <button
                type="button"
                onClick={onOpenWalletSwitcher}
                className="inline-flex min-h-9 items-center rounded-full border border-border-soft bg-canvas/70 px-3 text-[11px] font-semibold text-text-soft transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised md:hidden"
              >
                Switch
              </button>
            ) : null}
            <Link
              href={primaryWorkspaceHref}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-accent px-3 text-[11px] font-semibold text-text-on-accent shadow-accent-rest transition-[background-color,transform,box-shadow] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            >
              {primaryWalletName ? (
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {primaryActionLabel}
            </Link>
          </div>
          </div>
        ) : null}
        </div>
        {selectedSurface ? (
          <ProductDashboardVisual surface={selectedSurface} />
        ) : null}
      </div>
    </section>
  );
}

function MobileWalletSwitchModal({
  open,
  wallets,
  balances,
  loadingBalances,
  pendingByWallet,
  onClose,
}: {
  open: boolean;
  wallets: OnchainMembership[];
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  pendingByWallet: Map<string, number>;
  onClose: () => void;
}) {
  const [pinTick, setPinTick] = useState(0);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);
  useEffect(() => subscribePinnedWallets(() => setPinTick((n) => n + 1)), []);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const ordered = useMemo(() => {
    void pinTick;
    return sortPinnedFirst(wallets, (membership) => membership.wallet_name ?? "");
  }, [wallets, pinTick]);

  const grouped = useMemo(() => {
    const buckets = new Map<WalletProductSurface | "shared", OnchainMembership[]>();
    for (const membership of ordered) {
      const surface =
        resolveWalletProductSurface(membership.wallet_name ?? "") ?? "shared";
      const bucket = buckets.get(surface) ?? [];
      bucket.push(membership);
      buckets.set(surface, bucket);
    }

    const productGroups = (
      ["personal", "pro", "agent", "secure"] satisfies WalletProductSurface[]
    )
      .map((surface) => ({
        key: surface,
        label: productWorkspaceLabel(surface),
        Icon: PRODUCT_SURFACE_ICON[surface],
        wallets: buckets.get(surface) ?? [],
      }))
      .filter((group) => group.wallets.length > 0);

    const shared = buckets.get("shared") ?? [];
    return shared.length > 0
      ? [
          ...productGroups,
          {
            key: "shared",
            label: "Shared wallets",
            Icon: Wallet,
            wallets: shared,
          },
        ]
      : productGroups;
  }, [ordered]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[500] bg-canvas md:flex md:items-center md:justify-center md:bg-black/55 md:p-6 md:backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Switch workspace"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <motion.div
            className="flex h-full flex-col bg-canvas md:h-auto md:max-h-[min(760px,calc(100vh-3rem))] md:w-full md:max-w-xl md:overflow-hidden md:rounded-card md:border md:border-border-soft md:bg-surface-raised md:shadow-card-rest"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", stiffness: 360, damping: 34 }}
          >
            <header className="relative flex h-16 shrink-0 items-center justify-between border-b border-border-soft bg-canvas px-4">
              <button
                type="button"
                onClick={onClose}
                aria-label="Back to wallet home"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-border-soft bg-surface-raised text-text-strong shadow-[0_10px_28px_-20px_rgba(0,0,0,0.7)] transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <h2 className="pointer-events-none absolute left-1/2 -translate-x-1/2 text-base font-semibold tracking-tight text-text-strong">
                Switch
              </h2>
              <span className="h-10 w-10" aria-hidden="true" />
            </header>

            <div className="flex-1 overflow-y-auto px-4 pb-8 pt-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.28em] text-text-soft">
                    Choose workspace
                  </p>
                  <p className="mt-1 text-sm text-text-soft">
                    Pick a wallet to open its workspace.
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-surface-raised px-2.5 py-1 font-numerals text-xs font-semibold text-text-soft">
                  {wallets.length}
                </span>
              </div>
              <div className="mt-5 flex flex-col gap-5">
                {grouped.map(({ key, label, Icon, wallets: groupWallets }) => (
                  <section key={key}>
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
                          <Icon
                            className="h-3.5 w-3.5"
                            strokeWidth={1.9}
                            aria-hidden="true"
                          />
                        </span>
                        <p className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.22em] text-text-soft">
                          {label}
                        </p>
                      </div>
                      <span className="font-numerals text-xs font-semibold text-text-soft tabular-nums">
                        {groupWallets.length}
                      </span>
                    </div>
                    <div className="flex flex-col gap-2.5">
                      {groupWallets.map((membership) => (
                        <MobileWalletSwitchRow
                          key={membership.wallet}
                          membership={membership}
                          balanceLamports={balances?.get(membership.wallet) ?? null}
                          loadingBalance={loadingBalances}
                          pendingCount={pendingByWallet.get(membership.wallet) ?? 0}
                          onNavigate={onClose}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function MobileWalletSwitchRow({
  membership,
  balanceLamports,
  loadingBalance,
  pendingCount,
  onNavigate,
}: {
  membership: OnchainMembership;
  balanceLamports: number | null;
  loadingBalance: boolean;
  pendingCount: number;
  onNavigate: () => void;
}) {
  const onChainName = membership.wallet_name ?? "Wallet";
  const name = toDisplayName(onChainName);
  const surface = resolveWalletProductSurface(onChainName);
  const ProductIcon = surface ? PRODUCT_SURFACE_ICON[surface] : Wallet;
  const productLabel = surface ? productWorkspaceLabel(surface) : "Shared wallet";
  const href = productWorkspaceHomeHref(onChainName, surface);
  const balance = balanceLamports !== null ? formatBalance(balanceLamports) : null;
  const { hidden } = useBalancePrivacy();
  const hiddenClass = hidden ? "blur-sm select-none" : "";

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="group flex items-center gap-3 rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest transition-[border-color,transform] duration-base hover:-translate-y-0.5 hover:border-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <ProductIcon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-base font-semibold text-text-strong">
          {name}
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            {productLabel}
          </span>
          <span className="h-1 w-1 shrink-0 rounded-full bg-border-strong" />
          {loadingBalance && balance === null ? (
            <Shimmer className="h-3.5 w-14 rounded-full" />
          ) : (
            <span
              className={clsx(
                "font-numerals text-xs font-semibold text-text-soft tabular-nums transition-[filter] duration-base",
                hiddenClass,
              )}
            >
              {`${balance?.amount ?? "0"} ${balance?.ticker ?? "SOL"}`}
            </span>
          )}
        </span>
      </span>
      {pendingCount > 0 ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold text-text-on-accent">
          {pendingCount}
        </span>
      ) : null}
      <ArrowRight
        className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden="true"
      />
    </Link>
  );
}

function productDashboardCopy(surface: WalletProductSurface | null): {
  Icon: LucideIcon;
  title: string;
  body: string;
  footer: string;
} {
  switch (surface) {
    case "personal":
      return {
        Icon: Users,
        title: "Shared money, fewer steps.",
        body: "Send, receive, add trusted people, and keep protection simple.",
        footer: "Personal actions",
      };
    case "pro":
      return {
        Icon: Building2,
        title: "Treasury control for teams.",
        body: "Review team wallets, approvals, protection, and audit-ready activity before money moves.",
        footer: "Pro treasury",
      };
    case "agent":
      return {
        Icon: Bot,
        title: "Trading agents with safety checks.",
        body: "Choose a trader, set a budget, approve the safety checks, and watch every decision.",
        footer: "Agent trading",
      };
    case "secure":
      return {
        Icon: KeyRound,
        title: "Recovery without panic.",
        body: "Create a recovery vault, enroll trusted devices, and keep sweep actions isolated from spending.",
        footer: "Secure recovery",
      };
    default:
      return {
        Icon: Wallet,
        title: "Product workspaces",
        body: "Choose a product to continue.",
        footer: "ClearSig - all products",
      };
  }
}

function productOpenLabel(surface: WalletProductSurface | null): string {
  switch (surface) {
    case "pro":
      return "Open treasury";
    case "agent":
      return "Open agent vault";
    case "secure":
      return "Open Secure";
    case "personal":
      return "Open wallet";
    default:
      return "Open wallet";
  }
}

function surfaceHeroTone(surface: WalletProductSurface): string {
  switch (surface) {
    case "personal":
      return "border-emerald-300/20 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(6,78,59,0.16))]";
    case "pro":
      return "border-sky-300/20 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(14,116,144,0.16))]";
    case "agent":
      return "border-accent/25 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(204,255,0,0.10))]";
    case "secure":
      return "border-fuchsia-200/20 bg-[linear-gradient(135deg,var(--clear-surface-raised),rgba(126,34,206,0.15))]";
  }
}

function ProductDashboardVisual({ surface }: { surface: WalletProductSurface }) {
  return (
    <div
      aria-hidden="true"
      className="relative hidden min-h-[10rem] overflow-hidden rounded-card border border-border-soft bg-canvas/55 p-3 lg:block"
    >
      {surface === "personal" ? <PersonalDashboardVisual /> : null}
      {surface === "pro" ? <ProDashboardVisual /> : null}
      {surface === "agent" ? <AgentDashboardVisual /> : null}
      {surface === "secure" ? <SecureDashboardVisual /> : null}
    </div>
  );
}

function PersonalDashboardVisual() {
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <div className="flex -space-x-2">
          {["bg-emerald-300", "bg-sky-200", "bg-lime-300"].map((tone) => (
            <span key={tone} className={clsx("h-8 w-8 rounded-full border-2 border-canvas", tone)} />
          ))}
        </div>
        <span className="rounded-full bg-emerald-300/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-300">
          Trusted people
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {["Send", "Receive", "Protect"].map((label) => (
          <span key={label} className="rounded-xl border border-border-soft bg-surface-raised px-2 py-2 text-center text-[10px] font-medium text-text-strong">
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ProDashboardVisual() {
  return (
    <div className="flex h-full flex-col gap-2.5">
      {["Payroll", "Vendor payout", "Ops budget"].map((label, index) => (
        <div key={label} className="rounded-xl border border-border-soft bg-surface-raised p-2.5">
          <div className="flex items-center justify-between text-[10px] font-medium text-text-soft">
            <span>{label}</span>
            <span>{index + 1}/3</span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-border-soft">
            <div className={clsx("h-full rounded-full bg-sky-300", index === 0 ? "w-3/4" : index === 1 ? "w-1/2" : "w-1/3")} />
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentDashboardVisual() {
  return (
    <div className="flex h-full flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[10px] font-semibold text-accent">
          Live monitor
        </span>
        <span className="h-2 w-2 rounded-full bg-accent" />
      </div>
      <div className="flex items-end gap-1.5">
        {[32, 54, 42, 72, 52, 86, 62].map((height, index) => (
          <span key={index} className="flex-1 rounded-t bg-accent/70" style={{ height }} />
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <span className="rounded-xl border border-accent/20 bg-accent/[0.07] px-2 py-2 text-[10px] font-medium text-accent">
          Safety
        </span>
        <span className="rounded-xl border border-border-soft bg-surface-raised px-2 py-2 text-[10px] font-medium text-text-soft">
          Pause
        </span>
      </div>
    </div>
  );
}

function SecureDashboardVisual() {
  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full border border-fuchsia-200/20 bg-fuchsia-200/[0.06]">
        <KeyRound className="h-9 w-9 text-fuchsia-200" strokeWidth={1.8} />
      </div>
      <div className="grid gap-2">
        {["Passkey", "Trusted device", "Recovery sweep"].map((label) => (
          <span key={label} className="flex items-center gap-2 rounded-xl border border-border-soft bg-surface-raised px-3 py-2 text-[10px] font-medium text-text-soft">
            <ShieldCheck className="h-3.5 w-3.5 text-fuchsia-200" />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

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
        "rounded-card border bg-surface-raised p-3 shadow-card-rest sm:p-4",
        "transition-[border-color,box-shadow] duration-base ease-out-soft",
        accent ? "border-accent/40" : "border-border-soft",
      )}
    >
      <div className="flex items-center gap-1.5 text-text-soft sm:gap-2">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} aria-hidden="true" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
          {label}
        </span>
      </div>
      {loading ? (
        <Shimmer className="mt-2.5 h-7 w-24 rounded" />
      ) : (
        <p className="mt-1 flex items-baseline gap-1.5 sm:mt-1.5">
          <span
            className={clsx(
              "font-numerals text-xl font-semibold tabular-nums leading-tight sm:text-2xl",
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

// â”€â”€â”€ Memberships error state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        Quick hiccup talking to the network. Your workspaces are safe; we
        just couldn&rsquo;t fetch them right now.
      </p>
      <Button size="md" className="mt-4" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// â”€â”€â”€ First-visit empty state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function FirstVisitCard({
  selectedSurface,
}: {
  selectedSurface: WalletProductSurface | null;
}) {
  if (!selectedSurface) {
    return (
      <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-8">
        <div className="flex flex-col items-center gap-3 text-center sm:gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 sm:h-14 sm:w-14">
            <Layers className="h-6 w-6 text-accent sm:h-7 sm:w-7" strokeWidth={1.75} />
          </div>
          <div>
            <h2 className="font-display text-xl font-semibold text-text-strong sm:text-display-xs">
              Choose your ClearSig
            </h2>
            <p className="mt-1 text-sm text-text-soft">
              Pick one product first. We will remember it after that.
            </p>
          </div>
          <Link href="/choose">
            <Button size="lg">
              Choose product
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }
  const surface = selectedSurface ?? "personal";
  const product = productSurfaceById(surface);
  const Icon = PRODUCT_ICON[surface];
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest sm:p-8">
      <div className="flex flex-col items-center gap-3 text-center sm:gap-4">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 sm:h-14 sm:w-14">
          <Icon className="h-6 w-6 text-accent sm:h-7 sm:w-7" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className="font-display text-xl font-semibold text-text-strong sm:text-display-xs">
            Start with {product.shortName}
          </h2>
        </div>
        <Link href={productSetupHref(surface)}>
          <Button size="lg">
            Create {product.shortName}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Link>
      </div>
    </div>
  );
}

function ProductEmptyState({
  selectedSurface,
}: {
  selectedSurface: WalletProductSurface;
}) {
  const product = productSurfaceById(selectedSurface);
  const Icon = PRODUCT_ICON[selectedSurface];

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3 sm:gap-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20 sm:h-12 sm:w-12">
            <Icon className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-text-soft">
              {product.shortName}
            </p>
            <h2 className="mt-1 font-display text-lg font-semibold text-text-strong sm:text-xl">
              No {productWorkspaceLabel(selectedSurface).toLowerCase()} yet
            </h2>
          </div>
        </div>
        <Link href={productSetupHref(selectedSurface)} className="shrink-0">
          <Button size="md">
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create
          </Button>
        </Link>
      </div>
    </section>
  );
}

const PRODUCT_ICON: Record<WalletProductSurface, LucideIcon> = {
  personal: PRODUCT_SURFACE_ICON.personal,
  pro: PRODUCT_SURFACE_ICON.pro,
  agent: PRODUCT_SURFACE_ICON.agent,
  secure: PRODUCT_SURFACE_ICON.secure,
};

function Shimmer({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "block animate-shimmer bg-border-soft/55 bg-skeleton-shimmer bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

// â”€â”€â”€ Recent activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RecentActivityProps {
  rows: RecentActivityRow[];
  loading: boolean;
  reduce: boolean;
}

function RecentActivitySection({ rows, loading, reduce }: RecentActivityProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const latest = groupRecentActivityRows(rows).slice(0, 3);
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
      <ul className="mt-3 grid gap-2">
        {loading && latest.length === 0 ? (
          <>
            <ActivitySkeleton />
            <ActivitySkeleton />
            <ActivitySkeleton />
          </>
        ) : (
          latest.map((group, i) => (
            <motion.li
              key={group.row.proposalPda}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={reduce ? {} : { opacity: 1, y: 0 }}
              transition={{ duration: 0.18, delay: reduce ? 0 : i * 0.025 }}
            >
              <ActivityRow group={group} />
            </motion.li>
          ))
        )}
      </ul>
    </motion.section>
  );
}

function ActivitySkeleton() {
  return (
    <li
      aria-hidden="true"
      className="flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface-raised px-4 py-3 shadow-card-rest"
    >
      <Shimmer className="h-9 w-9 shrink-0 rounded-full" />
      <span className="min-w-0 flex-1">
        <Shimmer className="h-4 w-36 rounded" />
        <Shimmer className="mt-2 h-3 w-48 max-w-full rounded" />
      </span>
      <Shimmer className="h-4 w-4 shrink-0 rounded-full" />
    </li>
  );
}

function ActivityRow({ group }: { group: RecentActivityGroup }) {
  const { row, count } = group;
  // proposedAt is unix seconds (bigint); relativeTime handles the
  // ms conversion. Passing pre-multiplied milliseconds here was a
  // long-standing bug that printed "just now" forever.
  const time = relativeTime(row.proposedAt);
  const action = activityGroupTitle(
    count,
    friendlyIntentLabel(row.intentTemplate),
  );
  return (
      <Link
        href={`/app/proposals/${row.proposalPda}`}
        className={
          "group flex items-center justify-between gap-3 rounded-card border border-border-soft bg-surface-raised px-4 py-3 shadow-card-rest " +
          "transition-[border-color,background-color,box-shadow] duration-base ease-out-soft hover:border-accent/40 hover:bg-canvas hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Activity className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-text-strong">
            {action}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            <span>{toDisplayName(row.walletName)}</span>
            <span aria-hidden="true" className="mx-1.5 text-text-soft">/</span>
            <span className={statusTextColor(row.status)}>{friendlyStatus(row.status, row.intentTemplate)}</span>
            <span aria-hidden="true" className="mx-1.5 text-text-soft">-</span>
            <span>{time}</span>
          </p>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
  );
}

// â”€â”€â”€ Bits & pieces â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
      {children}
    </h2>
  );
}

// â”€â”€â”€ Watching (Tier-4 view-only) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Local-first watch list. Adds a wallet by its on-chain name (with
// the `#XXXXXX` creator suffix) to localStorage; on mount, every
// watched wallet is re-fetched on chain so balances stay current.
// Watching stays read-only: these rows are for monitoring, not for
// switching into an owned wallet.
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
              {busy ? "Adding..." : "Watch"}
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
            <li className="flex items-center gap-3 px-5 py-3">
              <Shimmer className="h-8 w-8 shrink-0 rounded-full" />
              <span className="min-w-0 flex-1">
                <Shimmer className="h-3.5 w-28 rounded" />
                <Shimmer className="mt-2 h-3 w-20 rounded" />
              </span>
            </li>
          ) : (
            rows.map((m) => {
              const display = toDisplayName(m.wallet_name ?? "");
              const pending = pendingByWallet.get(m.wallet) ?? 0;
              const walletName = m.wallet_name ?? "";
              const surface = resolveWalletProductSurface(walletName);
              return (
                <li key={m.wallet}>
                  <div className="group flex items-center justify-between gap-3 px-5 py-3">
                    <Link
                      href={productWorkspaceHomeHref(walletName, surface)}
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
