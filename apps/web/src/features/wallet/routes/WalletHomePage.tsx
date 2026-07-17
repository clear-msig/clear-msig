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
import { useSearchParams } from "next/navigation";
import clsx from "clsx";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { PublicKey } from "@solana/web3.js";
import {
  ArrowRight,
  Bell,
  Eye,
  EyeOff,
  Plus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { fetchOnchainMemberships, type OnchainMembership } from "@/lib/memberships/client";
import {
  useWatchedWallets,
} from "@/lib/hooks/useWatchedWallets";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Button } from "@/components/retail/Button";
import { BrandMark } from "@/components/retail/BrandMark";
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
  saveSelectedProductSurface,
} from "@/lib/productSession";
import { useBalancePrivacy } from "@/lib/hooks/useBalancePrivacy";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";
import {
  FirstVisitCard,
  MembershipsErrorCard,
  ProductEmptyState,
  RecentActivitySection,
  Shimmer,
  StatCard,
  WatchedWalletsSection,
} from "@/features/wallet/ui/home/WalletDashboardSections";
import {
  productDashboardCopy,
  productOpenLabel,
  surfaceHeroTone,
} from "@/features/wallet/domain/dashboardCopy";
import { ProductDashboardVisual } from "@/features/wallet/ui/home/ProductDashboardVisual";
import { MobileWalletSwitchModal } from "@/features/wallet/ui/home/MobileWalletSwitchModal";

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
  useEffect(() => {
    const pendingSurface = walletProductSurface(readPendingProductSurface());
    if (!pendingSurface) return;
    saveSelectedProductSurface(pendingSurface, address);
    clearPendingProductSurface();
    if (typeof window !== "undefined" && !requestedSurface && !requestedAll) {
      window.history.replaceState(
        null,
        "",
        `/app/wallet?surface=${pendingSurface}`,
      );
    }
  }, [address, requestedAll, requestedSurface]);

  useEffect(() => {
    if (!requestedSurface) return;
    saveSelectedProductSurface(requestedSurface, address);
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
  // Home is wallet-first. Product filters only apply when explicitly
  // requested in the URL; a remembered creation choice must not hide
  // the rest of the user's wallets on return visits.
  const selectedSurface = requestedAll ? null : requestedSurface;
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
    if (walletCount === 0) return "Create a wallet to get going.";
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
    : "Your wallets";

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
        : `Continue with ${displayName} or create another wallet.`;
  const createHref = selectedSurface
    ? productSetupHref(selectedSurface)
    : "/app/wallet/new";
  const createLabel = "New wallet";

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
  const SurfaceIcon = selectedSurface
    ? PRODUCT_SURFACE_ICON[selectedSurface]
    : null;
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
              {SurfaceIcon ? (
                <SurfaceIcon className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
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
