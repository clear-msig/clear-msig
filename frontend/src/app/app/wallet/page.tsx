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

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
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
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  KeyRound,
  Pin,
  PinOff,
  Plus,
  ShieldCheck,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
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
import { getWalletAppearance } from "@/lib/retail/walletAppearance";
import { useWalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { chainByKind } from "@/lib/retail/chains";
import {
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
  productWorkspaceHref as productSurfaceWorkspaceHref,
} from "@/lib/productSurfaces";
import {
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
  });

  const action = useActionNeeded();
  const recent = action.activity;
  const watched = useWatchedWallets();

  const wallets = useMemo(() => memberships.data ?? [], [memberships.data]);
  const selectedSurface = activeSurface;
  const selectSurface = (surface: WalletProductSurface | null) => {
    setActiveSurface(surface);
    if (surface) {
      saveSelectedProductSurface(surface, address);
      setStoredSurface(surface);
    }
    if (typeof window !== "undefined") {
      const url = surface ? `/app/wallet?surface=${surface}` : "/app/wallet?surface=all";
      window.history.pushState(null, "", url);
    }
  };
  const visibleWallets = useMemo(() => {
    if (!selectedSurface) return wallets;
    return wallets.filter(
      (membership) =>
        walletProductSurface(
          getWalletAppearance(membership.wallet_name ?? "")?.surface,
        ) === selectedSurface,
    );
  }, [wallets, selectedSurface]);
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

  const filteredActionRows = useMemo(
    () =>
      selectedSurface
        ? action.rows.filter((row) => visibleWalletNames.has(row.walletName))
        : action.rows,
    [action.rows, selectedSurface, visibleWalletNames],
  );
  const filteredRecentRows = useMemo(
    () =>
      selectedSurface
        ? recent.rows.filter((row) => visibleWalletPdas.has(row.walletPda))
        : recent.rows,
    [recent.rows, selectedSurface, visibleWalletPdas],
  );
  const visiblePendingByWallet = useMemo(() => {
    if (!selectedSurface) return recent.pendingByWallet;
    const next = new Map<string, number>();
    for (const membership of visibleWallets) {
      const count = recent.pendingByWallet.get(membership.wallet) ?? 0;
      if (count > 0) next.set(membership.wallet, count);
    }
    return next;
  }, [recent.pendingByWallet, selectedSurface, visibleWallets]);
  const filteredPendingCount = filteredActionRows.length;

  const showStats =
    !selectedSurface && !hasError && !isFirstVisit && visibleWallets.length > 0;
  const showRecent = !isFirstVisit && filteredRecentRows.length > 0;
  const showWatched = !hasError && selectedSurface === null;

  const showWalletGrid =
    !hasError &&
    !isFirstVisit &&
    !(selectedSurface && visibleWallets.length === 0 && !stillLoading);
  const walletGrid = showWalletGrid ? (
    <WalletsGrid
      wallets={visibleWallets}
      pendingByWallet={visiblePendingByWallet}
      balances={balancesQuery.data}
      loadingBalances={balancesQuery.isLoading}
      loading={stillLoading}
      selectedSurface={selectedSurface}
      reduce={!!reduce}
    />
  ) : null;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      <UnsupportedSignerBanner />

      {/* Compact hero - left-aligned title + dynamic summary line.
          Replaces the centered "Welcome back" block; gives back the
          vertical real estate to actionable content below. */}
      <Hero
        walletCount={visibleWallets.length}
        pendingCount={filteredPendingCount}
        selectedSurface={selectedSurface}
        loading={stillLoading}
        reduce={!!reduce}
      />

      {!hasError && !isFirstVisit ? (
        <ProductWorkspaceSwitcher
          selectedSurface={selectedSurface}
          wallets={wallets}
          onSelect={selectSurface}
        />
      ) : null}

      {selectedSurface ? walletGrid : null}

      {showStats && (
        <StatsRow
          visibleWallets={visibleWallets}
          balances={balancesQuery.data}
          loadingBalances={balancesQuery.isLoading}
          pendingCount={filteredPendingCount}
          selectedSurface={selectedSurface}
          reduce={!!reduce}
        />
      )}

      {hasError ? (
        <MembershipsErrorCard onRetry={() => memberships.refetch()} />
      ) : isFirstVisit && watched.rows.length === 0 ? (
        <FirstVisitCard selectedSurface={selectedSurface} />
      ) : selectedSurface && visibleWallets.length === 0 && !stillLoading ? (
        <ProductEmptyState selectedSurface={selectedSurface} />
      ) : (
        selectedSurface ? null : walletGrid
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
              <RecentActivitySection rows={filteredRecentRows} reduce={!!reduce} />
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
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardSkeleton />
        <CardSkeleton />
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
      className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3"
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

function ProductWorkspaceSwitcher({
  selectedSurface,
  wallets,
  onSelect,
}: {
  selectedSurface: WalletProductSurface | null;
  wallets: OnchainMembership[];
  onSelect: (surface: WalletProductSurface | null) => void;
}) {
  const counts = useMemo(() => {
    const next = new Map<WalletProductSurface, number>();
    for (const membership of wallets) {
      const surface = resolveWalletProductSurface(membership.wallet_name ?? "");
      if (!surface) continue;
      next.set(surface, (next.get(surface) ?? 0) + 1);
    }
    return next;
  }, [wallets]);
  const items: Array<{ id: WalletProductSurface; Icon: LucideIcon }> = [
    { id: "personal", Icon: PRODUCT_SURFACE_ICON.personal },
    { id: "pro", Icon: PRODUCT_SURFACE_ICON.pro },
    { id: "agent", Icon: PRODUCT_SURFACE_ICON.agent },
    { id: "secure", Icon: PRODUCT_SURFACE_ICON.secure },
  ];

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-2.5 shadow-card-rest sm:p-3">
      <div className="flex items-center gap-1.5 overflow-x-auto sm:gap-2">
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-pressed={selectedSurface === null}
          className={clsx(
            "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-soft px-2.5 text-xs font-medium transition-colors sm:min-h-10 sm:gap-2 sm:px-3",
            selectedSurface === null
              ? "bg-accent/10 text-accent"
              : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
          )}
        >
          <Wallet className="h-4 w-4" aria-hidden="true" />
          All
          <span className="font-numerals text-[11px] tabular-nums">
            {wallets.length}
          </span>
        </button>
        {items.map(({ id, Icon }) => {
          const product = productSurfaceById(id);
          const active = selectedSurface === id;
          if (id === "secure") {
            return (
              <Link
                key={id}
                href={productSurfaceWorkspaceHref(id)}
                className={clsx(
                  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-soft px-2.5 text-xs font-medium transition-colors sm:min-h-10 sm:gap-2 sm:px-3",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {product.shortName}
                <span className="font-numerals text-[11px] tabular-nums">
                  {counts.get(id) ?? 0}
                </span>
              </Link>
            );
          }
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSelect(id)}
              aria-pressed={active}
              className={clsx(
                "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-soft px-2.5 text-xs font-medium transition-colors sm:min-h-10 sm:gap-2 sm:px-3",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {product.shortName}
              <span className="font-numerals text-[11px] tabular-nums">
                {counts.get(id) ?? 0}
              </span>
            </button>
          );
        })}
      </div>
    </section>
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
  balances,
  loadingBalances,
  pendingCount,
  selectedSurface,
  reduce,
}: {
  visibleWallets: OnchainMembership[];
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  pendingCount: number;
  selectedSurface: WalletProductSurface | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const totalLamports = useMemo(() => {
    if (!balances) return 0;
    let sum = 0;
    for (const m of visibleWallets) sum += balances.get(m.wallet) ?? 0;
    return sum;
  }, [visibleWallets, balances]);

  const totalBalance = formatBalance(totalLamports);
  const balanceLoading = loadingBalances && balances === undefined;

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-2.5 sm:gap-3"
    >
      <BalanceHeroCard
        amount={totalBalance.amount}
        unit={totalBalance.ticker}
        totalLamports={totalLamports}
        walletCount={visibleWallets.length}
        selectedSurface={selectedSurface}
        loading={balanceLoading}
      />
      {/* Secondary stats - Wallets count and pending-approval bell.
          Side-by-side on every viewport so the two metrics carry
          equal visual weight under the hero. */}
      <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
        <StatCard
          Icon={Users}
          label={selectedSurface ? "In product" : "Wallets"}
          value={String(visibleWallets.length)}
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
  const surface = walletProductSurface(getWalletAppearance(walletName)?.surface);
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
// Lead card on Home - total SOL balance across every wallet the
// member belongs to. Treated like a premium debit-card surface:
//   â€¢ A subtle accent gradient washes the panel (top-left â†’ bottom-right)
//   â€¢ A grid of large, very-low-opacity BrandMark icons sits behind
//     the content as a watermark - ties the card to the product
//     identity without competing with the number
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
  walletCount,
  selectedSurface,
  loading,
}: {
  amount: string;
  unit: string;
  totalLamports: number;
  walletCount: number;
  selectedSurface: WalletProductSurface | null;
  loading: boolean;
}) {
  const label = selectedSurface
    ? productWorkspaceLabel(selectedSurface)
    : "Total balance";
  const surfaceCopy = productDashboardCopy(selectedSurface);
  const { hidden, toggle } = useBalancePrivacy();
  const hiddenClass = hidden ? "blur-sm select-none" : "";
  return (
    <section
      className={clsx(
        "relative overflow-hidden rounded-card border p-4 shadow-card-rest sm:p-5 lg:p-6",
        selectedSurface
          ? surfaceHeroTone(selectedSurface)
          : "border-border-soft bg-surface-raised",
      )}
    >
      {!selectedSurface ? <BalanceCardPattern /> : null}

      {/* Foreground content. relative + z-10 keeps it above both
          decoration layers. */}
      <div className="relative z-10 grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center lg:gap-5">
        <div className="min-w-0">
        {/* Brand row - small visible mark + label */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent/15">
              {selectedSurface ? (
                <surfaceCopy.Icon className="h-4 w-4 text-accent" aria-hidden="true" />
              ) : (
                <BrandMark size={14} />
              )}
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              {label}
            </span>
          </div>
          {!loading && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-text-soft/70">
                {walletCount === 0
                  ? "-"
                  : walletCount === 1
                    ? "1 wallet"
                    : `${walletCount} wallets`}
              </span>
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
            </div>
          )}
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
        {loading ? (
          <div className="mt-3 h-10 w-40 animate-pulse rounded bg-border-soft/80 sm:mt-5 sm:h-12 sm:w-52" />
        ) : (
          <>
            <p className={clsx("mt-3 flex items-baseline gap-2 transition-[filter] duration-base sm:mt-5", hiddenClass)}>
              <span className="font-numerals text-3xl font-semibold leading-none text-text-strong tabular-nums sm:text-4xl">
                {amount}
              </span>
              <span className="font-display text-sm font-semibold uppercase tracking-[0.16em] text-text-soft sm:text-base">
                {unit}
              </span>
            </p>
            <p className={clsx("mt-1.5 text-xs text-text-soft transition-[filter] duration-base sm:text-sm", hiddenClass)}>
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

        <div className="mt-4 flex items-center justify-between gap-3 sm:mt-5">
          <p className="min-w-0 truncate font-mono text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft sm:text-[11px]">
            {selectedSurface ? surfaceCopy.footer : "ClearSig - all products"}
          </p>
          <Link
            href={selectedSurface ? productSetupHref(selectedSurface) : "/choose"}
            className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-accent px-3 text-[11px] font-semibold text-text-on-accent shadow-accent-rest transition-[background-color,transform,box-shadow] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            {selectedSurface ? surfaceCopy.cta : "Choose product"}
          </Link>
        </div>
        </div>
        {selectedSurface ? (
          <ProductDashboardVisual surface={selectedSurface} />
        ) : null}
      </div>
    </section>
  );
}

function productDashboardCopy(surface: WalletProductSurface | null): {
  Icon: LucideIcon;
  title: string;
  body: string;
  footer: string;
  cta: string;
} {
  switch (surface) {
    case "personal":
      return {
        Icon: Users,
        title: "Shared money, fewer steps.",
        body: "Send, receive, add trusted people, and keep protection simple.",
        footer: "Personal actions",
        cta: "New personal",
      };
    case "pro":
      return {
        Icon: Building2,
        title: "Treasury control for teams.",
        body: "Review team wallets, approvals, protection, and audit-ready activity before money moves.",
        footer: "Pro treasury",
        cta: "New treasury",
      };
    case "agent":
      return {
        Icon: Bot,
        title: "Trading agents with safety checks.",
        body: "Choose a trader, set a budget, approve the safety checks, and watch every decision.",
        footer: "Agent trading",
        cta: "New agent vault",
      };
    case "secure":
      return {
        Icon: KeyRound,
        title: "Recovery without panic.",
        body: "Create a recovery vault, enroll trusted devices, and keep sweep actions isolated from spending.",
        footer: "Secure recovery",
        cta: "New recovery",
      };
    default:
      return {
        Icon: Wallet,
        title: "Product workspaces",
        body: "Choose a product to continue.",
        footer: "ClearSig - all products",
        cta: "Choose product",
      };
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
        <div className="mt-2.5 h-7 w-24 animate-pulse rounded bg-border-soft/80" />
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
        Quick hiccup talking to the network. Your wallets are safe; we
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

// â”€â”€â”€ Wallets grid â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface WalletsGridProps {
  wallets: OnchainMembership[];
  pendingByWallet: Map<string, number>;
  balances: Map<string, number> | undefined;
  loadingBalances: boolean;
  loading: boolean;
  selectedSurface: WalletProductSurface | null;
  reduce: boolean;
}

function WalletsGrid({
  wallets,
  pendingByWallet,
  balances,
  loadingBalances,
  loading,
  selectedSurface,
  reduce,
}: WalletsGridProps) {
  // Re-sort whenever the user pins/unpins. The hook subscribes to
  // both the same-tab event and cross-tab storage events so a pin
  // change in another tab also bubbles up here.
  const [pinTick, setPinTick] = useState(0);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => subscribePinnedWallets(() => setPinTick((n) => n + 1)), []);
  const ordered = useMemo(() => {
    void pinTick;
    return sortPinnedFirst(wallets, (m) => m.wallet_name ?? "");
  }, [wallets, pinTick]);
  const canStack = ordered.length > 1;
  const visible = expanded || !canStack ? ordered : ordered.slice(0, 3);

  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <SectionLabel>
          {selectedSurface
            ? productSurfaceById(selectedSurface).shortName
            : "Your wallets"}
        </SectionLabel>
        {canStack && !loading ? (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft transition-colors duration-base hover:border-accent/40 hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            {expanded ? "Hide" : "Expand"}
            {expanded ? (
              <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}
      </div>
      <div
        className={clsx(
          "mt-3",
          expanded || !canStack
            ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
            : "flex flex-col [perspective:1200px]",
        )}
      >
        {loading && wallets.length === 0 ? (
          <>
            <CardSkeleton />
            <CardSkeleton />
          </>
        ) : (
          <AnimatePresence initial={false}>
            {visible.map((m, i) => {
              const stacked = !expanded && canStack;
              const stackDepth = stacked ? Math.min(i, 2) : 0;
              return (
                <motion.div
                  key={m.wallet}
                  layout={!reduce}
                  initial={
                    reduce
                      ? false
                      : {
                          opacity: 0,
                          y: stacked ? 16 + stackDepth * 6 : 14,
                          scale: stacked ? 0.96 - stackDepth * 0.015 : 0.98,
                        }
                  }
                  animate={
                    reduce
                      ? {}
                      : {
                          opacity: 1,
                          y: 0,
                          scale: stacked ? 1 - stackDepth * 0.025 : 1,
                          rotateX: stacked ? stackDepth * -1.5 : 0,
                        }
                  }
                  exit={
                    reduce
                      ? {}
                      : {
                          opacity: 0,
                          y: -18,
                          scale: 0.97,
                          transition: { duration: 0.14, ease: [0.4, 0, 1, 1] },
                        }
                  }
                  transition={
                    reduce
                      ? undefined
                      : {
                          layout: {
                            type: "spring",
                            stiffness: 420,
                            damping: 34,
                            mass: 0.8,
                          },
                          opacity: { duration: 0.18, delay: Math.min(i, 4) * 0.025 },
                          y: {
                            type: "spring",
                            stiffness: 420,
                            damping: 32,
                            mass: 0.8,
                            delay: expanded ? Math.min(i, 6) * 0.025 : 0,
                          },
                          scale: {
                            type: "spring",
                            stiffness: 420,
                            damping: 34,
                            mass: 0.8,
                          },
                        }
                  }
                  className={clsx(
                    "relative origin-top transform-gpu",
                    stacked && i > 0 && "-mt-14",
                  )}
                  style={stacked ? { zIndex: visible.length - i } : undefined}
                >
                  <WalletCard
                    membership={m}
                    pendingCount={pendingByWallet.get(m.wallet) ?? 0}
                    balanceLamports={balances?.get(m.wallet) ?? null}
                    loadingBalance={loadingBalances}
                    // Cap the stagger at 4 so the last card paints in
                    // 80ms regardless of wallet count. Treasury users
                    // with 6+ wallets used to see 240ms+ of cascade,
                    // which read as jank on slow networks.
                    delay={reduce ? 0 : Math.min(i, 4) * 0.02}
                    reduce={reduce}
                    selectedSurface={selectedSurface}
                  />
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>
      <AnimatePresence initial={false}>
        {!expanded && canStack && ordered.length > visible.length ? (
          <motion.p
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            exit={reduce ? {} : { opacity: 0, y: -4 }}
            transition={{ duration: 0.16 }}
            className="mt-2 text-center text-[11px] text-text-soft sm:text-left"
          >
            Showing {visible.length} of {ordered.length}
          </motion.p>
        ) : null}
      </AnimatePresence>
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
  selectedSurface: WalletProductSurface | null;
}

function WalletCard({
  membership,
  pendingCount,
  balanceLamports,
  loadingBalance,
  delay,
  reduce,
  selectedSurface,
}: WalletCardProps) {
  const onChainName = membership.wallet_name ?? "Wallet";
  // The on-chain name carries a creator-derived suffix to keep PDAs
  // unique per user (see lib/retail/walletNames). Strip it for
  // display; URLs and API calls keep using the on-chain form.
  const name = toDisplayName(onChainName);
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const solBalance =
    balanceLamports !== null ? formatBalance(balanceLamports) : null;
  const portfolio = useWalletPortfolio(onChainName);
  const portfolioBalance = useMemo(() => {
    const row =
      portfolio.breakdown.find(
        (chain) => chain.kind !== 0 && chain.raw !== null && chain.raw > 0n,
      ) ??
      portfolio.breakdown.find(
        (chain) => chain.kind === 0 && chain.raw !== null && chain.raw > 0n,
      ) ??
      portfolio.breakdown.find(
        (chain) => chain.kind !== 0 && chain.raw !== null,
      );
    if (!row || row.raw === null) return null;
    const meta = chainByKind(row.kind);
    if (!meta) return null;
    const amount = formatChainBalance(
      row.raw,
      meta.smallestPerWhole,
      meta.displayDecimals,
    );
    if (!amount) return null;
    return {
      amount,
      raw: row.raw,
      smallestPerWhole: meta.smallestPerWhole,
      ticker: meta.ticker,
    };
  }, [portfolio.breakdown]);
  const balance = portfolioBalance ?? solBalance;
  const surface = resolveWalletProductSurface(onChainName);
  const homeHref = productWorkspaceHomeHref(onChainName, surface);
  const productLabel = surface ? productWorkspaceLabel(surface) : null;
  const ProductIcon = surface ? PRODUCT_SURFACE_ICON[surface] : Wallet;
  const [pinned, setPinned] = useState(false);
  const { hidden } = useBalancePrivacy();
  const hiddenClass = hidden ? "blur-sm select-none" : "";
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
        href={homeHref}
        className={
          "group relative flex flex-col gap-2.5 overflow-hidden rounded-card border bg-surface-raised p-4 shadow-card-rest sm:gap-3 sm:p-5 " +
          "transition-[transform,box-shadow,border-color] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:shadow-card-raised " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
          (pinned ? "border-accent/40" : "border-border-soft")
        }
      >
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] sm:h-10 sm:w-10">
              <ProductIcon
                className="h-4 w-4 sm:h-[18px] sm:w-[18px]"
                strokeWidth={1.9}
                aria-hidden="true"
              />
            </span>
            <div className="min-w-0">
              {/* The pinned-state Pin icon used to also render inline
                  next to the name. With the corner pin button in
                  place (accent border + Pin icon when pinned) the
                  inline copy was duplicate chrome - both icons
                  visible, neither carrying signal the other didn't.
                  Keep only the corner button. */}
              <p className="font-display text-lg text-text-strong sm:text-xl">
                <span className="truncate">{name}</span>
              </p>
              {(portfolio.isLoading || loadingBalance) && balance === null ? (
                <div className="mt-1 h-5 w-20 animate-pulse rounded bg-border-soft" />
              ) : (
                // Editorial-sans: JetBrains Mono numerals for the
                // balance value, Manrope display caps for the ticker.
                // Same currency-code treatment as /send/* and Hero
                // single-chain balance - one shared pattern app-wide.
                <p className={clsx("mt-1 flex items-baseline gap-1.5 transition-[filter] duration-base", hiddenClass)}>
                  <span className="font-numerals text-base font-semibold text-text-strong tabular-nums">
                    {balance ? balance.amount : "0"}
                  </span>
                  <span className="font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-text-soft">
                    {balance?.ticker ?? "SOL"}
                  </span>
                  {portfolioBalance && portfolioBalance.raw > 0n ? (
                    <UsdHint
                      amount={portfolioBalance.raw}
                      smallestPerWhole={portfolioBalance.smallestPerWhole}
                      ticker={portfolioBalance.ticker}
                      className="text-[11px] text-text-soft tabular-nums"
                    />
                  ) : balanceLamports !== null && balanceLamports > 0 ? (
                    <UsdHint
                      amount={BigInt(Math.round(balanceLamports))}
                      smallestPerWhole={1_000_000_000n}
                      ticker="SOL"
                      className="text-[11px] text-text-soft tabular-nums"
                    />
                  ) : null}
                </p>
              )}
            </div>
          </div>
          <ArrowRight
            className="mt-1 h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
            aria-hidden="true"
          />
        </div>
        {!selectedSurface && productLabel ? (
          <span className="inline-flex self-start rounded-full border border-border-soft bg-canvas px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-text-soft">
            {productLabel}
          </span>
        ) : null}
        {pendingCount > 0 && (
          <div className="inline-flex items-center self-start rounded-full bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
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
          "absolute bottom-2.5 right-2.5 items-center justify-center rounded-full border bg-surface-raised sm:bottom-3 sm:right-3 " +
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

// â”€â”€â”€ Recent activity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface RecentActivityProps {
  rows: RecentActivityRow[];
  reduce: boolean;
}

function RecentActivitySection({ rows, reduce }: RecentActivityProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const latest = rows.slice(0, 3);
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
        {latest.map((row, i) => (
          <motion.li
            key={row.proposalPda}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={reduce ? {} : { opacity: 1, y: 0 }}
            transition={{ duration: 0.18, delay: reduce ? 0 : i * 0.025 }}
          >
            <ActivityRow row={row} />
          </motion.li>
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
  const action = friendlyIntentLabel(row.intentTemplate);
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
// Watching surfaces the same WalletCard the membership grid uses,
// flagged with a ðŸ‘ badge so users see at a glance which entries
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
            <li className="px-5 py-3 text-xs text-text-soft">
              Loading watched wallets...
            </li>
          ) : (
            rows.map((m) => {
              const display = toDisplayName(m.wallet_name ?? "");
              const pending = pendingByWallet.get(m.wallet) ?? 0;
              const walletName = m.wallet_name ?? "";
              const surface = walletProductSurface(
                getWalletAppearance(walletName)?.surface,
              );
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
