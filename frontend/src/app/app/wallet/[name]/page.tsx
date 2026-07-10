"use client";

// Wallet detail - retail rebuild (locked 2026-04-30).
//
// Replaces the legacy power-user wallet page (chain bindings,
// intent CRUD, PDA panels, DKG progress, raw approver tables).
// What a retail user actually needs to see and do here:
//
//   - Which wallet is this (name + member count).
//   - Send money (route to /app/wallet/[name]/send).
//   - Invite a friend (route to /welcome/invite?wallet=…).
//   - What's waiting on me ("needs your approval", filtered).
//   - What just happened ("recent activity", filtered).
//
// Power-user surfaces (chain bindings, intent management, raw PDA
// inspection) are intentionally not rendered here. They still exist
// in the codebase and will be cleaned up after the retail surface
// covers create / send / approve / member management.

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useParams, useSearchParams } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  ArrowRight,
  Coins,
  Settings as SettingsIcon,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import { HoldingsPanel } from "@/components/wallet/detail/HoldingsPanel";
import { WalletApprovalPanel } from "@/components/wallet/detail/WalletApprovalPanel";
import { WalletHero } from "@/components/wallet/detail/WalletHero";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { listIntents } from "@/lib/chain/intents";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findVaultAddress } from "@/lib/msig";
import { useActionNeeded, type ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import { useRecentActivity, type RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useTxAttempts } from "@/lib/hooks/useTxAttempts";
import { useWalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { isProductSurfaceId } from "@/lib/productSurfaces";
import {
  resolveWalletProductSurface,
  walletProductSurface,
  type WalletProductSurface,
} from "@/lib/productWorkspace";
import type { TxAttempt } from "@/lib/retail/txLog";
import {
  getWalletAppearance,
  saveWalletAppearance,
} from "@/lib/retail/walletAppearance";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useConnection } from "@/lib/wallet";

const WalletTourModal = dynamic(
  () =>
    import("@/components/onboarding/WalletTourModal").then(
      (mod) => mod.WalletTourModal,
    ),
  { ssr: false, loading: () => null },
);

const ActivityPanel = dynamic(
  () =>
    import("@/components/wallet/detail/ActivityPanel").then(
      (mod) => mod.ActivityPanel,
    ),
  { ssr: false, loading: () => <TabPanelSkeleton /> },
);

const ManagePanel = dynamic(
  () =>
    import("@/components/wallet/detail/ManagePanel").then(
      (mod) => mod.ManagePanel,
    ),
  { ssr: false, loading: () => <TabPanelSkeleton /> },
);

type WalletTab = "activity" | "holdings" | "manage";
const WALLET_TAB_ORDER: WalletTab[] = ["holdings", "activity", "manage"];

function readWalletTabFromHash(): WalletTab {
  if (typeof window === "undefined") return "holdings";
  const h = window.location.hash.replace(/^#/, "");
  if (h === "activity" || h === "manage") return h;
  return "holdings";
}

function useWalletProductSurface(walletName: string): WalletProductSurface | null {
  const searchParams = useSearchParams();
  const requested = searchParams.get("surface");
  const requestedSurface = walletProductSurface(
    isProductSurfaceId(requested) ? requested : null,
  );
  const [storedSurface, setStoredSurface] = useState<WalletProductSurface | null>(
    () => resolveWalletProductSurface(walletName),
  );

  useEffect(() => {
    const appearance = getWalletAppearance(walletName);
    const surface =
      walletProductSurface(appearance?.surface) ??
      resolveWalletProductSurface(walletName);
    setStoredSurface(surface);
  }, [walletName]);

  useEffect(() => {
    if (!requestedSurface) return;
    saveWalletAppearance(walletName, { surface: requestedSurface });
    setStoredSurface(requestedSurface);
  }, [requestedSurface, walletName]);

  return requestedSurface ?? storedSurface;
}

export default function WalletDetailPage() {
  const params = useParams<{ name: string }>();
  const rawName = params?.name ?? "";
  // `name` is the on-chain wallet name (carries the creator suffix
  // for PDA uniqueness). Used for chain lookups, URLs, API calls.
  // For display, run it through toDisplayName() so the user sees
  // their typed name without the suffix.
  const name = useMemo(() => {
    try {
      return decodeURIComponent(rawName);
    } catch {
      return rawName;
    }
  }, [rawName]);
  const reduce = useReducedMotion();
  const { connection } = useConnection();
  const [detailTab, setDetailTab] = useState<WalletTab>(
    readWalletTabFromHash,
  );
  const productSurface = useWalletProductSurface(name);
  const portfolio = useWalletPortfolio(name);

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

  // Vault balance - the lamports actually held by this wallet's vault
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

  // Whether the wallet has any active intents - gates the "Send money"
  // CTA. With zero intents, the program can't accept a proposal, so we
  // route the user to the one-tap setup screen instead.
  const hasIntents = useMemo(() => {
    if (!intentsQuery.data) return null;
    return intentsQuery.data.some((it) => it.account !== null);
  }, [intentsQuery.data]);

  const allActivity = useRecentActivity(50);
  const allAction = useActionNeeded();
  const sendAttempts = useTxAttempts(name, 5);

  const solanaVaultAddress = useMemo(() => {
    if (!walletQuery.data) return null;
    const [vault] = findVaultAddress(
      walletQuery.data.pda,
      CLEAR_WALLET_PROGRAM_ID,
    );
    return vault.toBase58();
  }, [walletQuery.data]);

  // Visible top-4 + the full filtered list for CSV export. Same
  // filter, two slice depths.
  const walletActivityAll = useMemo(
    () => allActivity.allRows.filter((r) => r.walletName === name),
    [allActivity.allRows, name],
  );
  const walletActivity = useMemo(
    () => walletActivityAll.slice(0, 4),
    [walletActivityAll],
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
    <div className="flex flex-col gap-4">
      {/* One-time onboarding tour. Self-gates on its own
          localStorage flag so it doesn't fire for users who've
          already seen it; renders nothing otherwise. Intentionally
          first in the tree so the overlay snaps in over a stable
          layout. */}
      <WalletTourModal />
      {/* Back navigation lives in the global DashboardHeader (desktop)
          and the BottomNav Home tab (mobile) - no per-page chrome
          needed here anymore. */}
      <WalletHero
        name={name}
        portfolio={portfolio}
        productSurface={productSurface}
        memberCount={memberCount}
        memberAddresses={memberAddresses}
        loadingMembers={intentsQuery.isLoading}
        balanceLamports={balanceQuery.data ?? null}
        loadingBalance={balanceQuery.isLoading}
        pendingApprovalCount={walletAction.length}
        reduce={!!reduce}
      />
      {/* Pending approvals come right after the hero - they're the
          single highest-priority action a wallet member can take.
          Always-visible, regardless of which tab is active, so a
          member with waiting proposals can't miss them by sitting
          on the Holdings tab. */}
      {walletAction.length > 0 && (
        <WalletApprovalPanel rows={walletAction} reduce={!!reduce} />
      )}
      <WalletDetailTabs
        tab={detailTab}
        onTabChange={setDetailTab}
        // Activity tab data
        activityRows={walletActivity}
        activityAllRows={walletActivityAll}
        sendAttempts={sendAttempts}
        solanaVaultAddress={solanaVaultAddress}
        // Manage tab data
        name={name}
        portfolio={portfolio}
        productSurface={productSurface}
        actionRows={walletAction}
        hasIntents={hasIntents}
        reduce={!!reduce}
      />
    </div>
  );
}

// ─── Tab nav ───────────────────────────────────────────────────────
//
// Phantom / Rainbow precedent: a wallet detail screen is a vertical
// dump in two ways - Hero on top, then a tabbed feed below. We
// already moved primary actions (Send / Receive / Protect) to the
// Hero tile row; the tabs here own the long-tail of content that
// previously stacked into 12 sections.
//
// Three tabs:
//   - Holdings: the wallet's money. ERC-20 tokens today; future
//     home for a per-chain balance breakdown.
//   - Activity: pending approvals already render above; this tab
//     adds local send attempts, multisig proposal feed, and the
//     per-chain on-chain history.
//   - Manage: product-specific icon actions for this wallet's chosen surface.
//
// Activity and Manage are persisted via URL hash. The base wallet URL
// opens Holdings for every product surface.

interface WalletDetailTabsProps {
  tab: WalletTab;
  onTabChange: (next: WalletTab) => void;
  activityRows: RecentActivityRow[];
  activityAllRows: RecentActivityRow[];
  sendAttempts: TxAttempt[];
  solanaVaultAddress: string | null;
  name: string;
  portfolio: ReturnType<typeof useWalletPortfolio>;
  productSurface: WalletProductSurface | null;
  actionRows: ActionNeededRow[];
  /// Tri-state to match the upstream useMemo: null while the
  /// intents query is in flight, true/false once known.
  hasIntents: boolean | null;
  reduce: boolean;
}

function WalletDetailTabs(props: WalletDetailTabsProps) {
  const {
    tab,
    onTabChange,
    activityRows,
    activityAllRows,
    sendAttempts,
    solanaVaultAddress,
    name,
    portfolio,
    productSurface,
    actionRows,
    hasIntents,
    reduce,
  } = props;
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      onTabChange(readWalletTabFromHash());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, [onTabChange]);
  // Tab-bar ref so a tab switch scrolls the user back to the bar's
  // top edge. Without this, switching from a deep-scrolled Activity
  // tab to the much shorter Holdings tab leaves the user mid-page on
  // empty content - the tap registers but reads as broken.
  const tabBarRef = useRef<HTMLDivElement>(null);
  const switchTab = (next: WalletTab) => {
    onTabChange(next);
    if (typeof window !== "undefined") {
      // Replace, not push - back-button in a wallet should leave
      // the wallet, not cycle through tabs the user already saw.
      const url =
        window.location.pathname +
        window.location.search +
        (next === "holdings" ? "" : `#${next}`);
      window.history.replaceState(null, "", url);
      // Defer to next frame so React commits the new tab content
      // before scroll, otherwise scrollIntoView lands on the old
      // panel and the user re-scrolls.
      requestAnimationFrame(() => {
        tabBarRef.current?.scrollIntoView({
          block: "start",
          behavior: "smooth",
        });
      });
    }
  };

  // Holdings count is the only one worth surfacing as a badge.
  // Activity sums to ~24+ on any wallet with chain history (5 chains
  // × 5 rows each + send attempts), so a perpetual "99+" badge reads
  // as decoration. Pending approvals are already pinned above the
  // tabs in ActionNeededSection - no need to repeat them here.
  const holdingsCount = portfolio.breakdown.length;

  return (
    <>
      <TabBar
        ref={tabBarRef}
        productSurface={productSurface}
        tab={tab}
        onSelect={switchTab}
        counts={{ holdings: holdingsCount }}
      />

      {tab === "activity" && (
        <ActivityPanel
          rows={activityRows}
          allRows={activityAllRows}
          walletName={name}
          attempts={sendAttempts}
          solanaVaultAddress={solanaVaultAddress}
          reduce={reduce}
        />
      )}

      {tab === "holdings" && (
        <HoldingsPanel
          walletName={name}
          portfolio={portfolio}
          reduce={reduce}
        />
      )}

      {tab === "manage" && (
        <ManagePanel
          name={name}
          productSurface={productSurface}
          actionRows={actionRows}
          activityRows={activityAllRows}
          attempts={sendAttempts}
          hasIntents={hasIntents}
          reduce={reduce}
        />
      )}
    </>
  );
}

interface TabBarProps {
  productSurface: WalletProductSurface | null;
  tab: WalletTab;
  onSelect: (next: WalletTab) => void;
  counts: { holdings: number };
}

const TabBar = forwardRef<HTMLDivElement, TabBarProps>(function TabBar(
  { productSurface, tab, onSelect, counts },
  ref,
) {
  const labels = tabLabelsFor(productSurface);
  const tabMeta: Record<
    WalletTab,
    {
      label: string;
      icon: React.ReactNode;
      count?: number;
    }
  > = {
    holdings: {
      label: labels.holdings,
      icon: <Coins className="h-4 w-4" strokeWidth={2} />,
      count: counts.holdings,
    },
    activity: {
      label: labels.activity,
      icon: <Activity className="h-4 w-4" strokeWidth={2} />,
    },
    manage: {
      label: labels.manage,
      icon: <SettingsIcon className="h-4 w-4" strokeWidth={2} />,
    },
  };
  const items: {
    id: WalletTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = WALLET_TAB_ORDER.map((id) => ({ id, ...tabMeta[id] }));

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Wallet view"
      // Static placement - sticky would collide with the mobile-only
      // BackLink which also pins at top-20. mt-2 gives it air from
      // the hero card above (gap-4 alone reads as flush).
      className="mt-2 mb-1 scroll-mt-24 print:hidden"
    >
      <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto">
        {items.map((it) => {
          const active = tab === it.id;
          return (
            <button
              key={it.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`wallet-tab-panel-${it.id}`}
              onClick={() => onSelect(it.id)}
              className={
                "group inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium " +
                "transition-colors duration-base ease-out-soft " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                (active
                  ? "bg-accent/10 text-accent"
                  : "text-text-soft hover:bg-glass-soft hover:text-text-strong")
              }
            >
              <span className={active ? "text-accent" : "text-text-soft group-hover:text-text-strong"}>
                {it.icon}
              </span>
              <span>{it.label}</span>
              {typeof it.count === "number" && it.count > 0 && (
                <span
                  className={
                    "ml-0.5 inline-flex h-4 min-w-[18px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-semibold " +
                    (active
                      ? "bg-accent/15 text-accent"
                      : "border border-border-soft bg-surface-raised text-text-soft")
                  }
                >
                  {it.count > 99 ? "99+" : it.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
});

function tabLabelsFor(surface: WalletProductSurface | null): Record<WalletTab, string> {
  if (surface === "personal") {
    return { holdings: "Money", activity: "History", manage: "More" };
  }
  if (surface === "pro") {
    return { holdings: "Assets", activity: "Ledger", manage: "Protection" };
  }
  if (surface === "agent") {
    return { holdings: "Funds", activity: "Journal", manage: "Setup" };
  }
  return { holdings: "Holdings", activity: "Activity", manage: "Manage" };
}

function TabPanelSkeleton() {
  return (
    <div aria-label="Loading wallet view" className="space-y-3">
      <div className="h-28 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
      <div className="h-20 animate-pulse rounded-card border border-border-soft bg-surface-raised" />
    </div>
  );
}

// ─── Manage tab actions ────────────────────────────────────────────
//
// The Manage tab owns low-frequency actions, but it must not become a
// product switcher. Rows are generated from the wallet's selected
// surface so Personal, Pro, and Agent vaults keep separate affordances.

// ─── Action needed (filtered to this wallet) ───────────────────────

// ─── Loading + not-found ───────────────────────────────────────────

// Geometry-matched detail skeleton - mirrors the Hero's header
// strip + balance card + action tiles so the loading state doesn't
// reflow when the real Hero hydrates.
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-5">
      {/* Header strip - avatar + eyebrow + title | chips */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 animate-pulse rounded-2xl bg-border-soft sm:h-16 sm:w-16" />
          <div className="flex flex-col gap-2">
            <div className="h-3 w-44 animate-pulse rounded bg-border-soft/60" />
            <div className="h-8 w-56 animate-pulse rounded bg-border-soft sm:h-10 sm:w-64" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-28 animate-pulse rounded-full bg-border-soft/70" />
          <div className="h-7 w-32 animate-pulse rounded-full bg-border-soft/60" />
        </div>
      </div>

      {/* Balance card - portfolio headline + 3-up action tiles. */}
      <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex flex-col gap-2">
          <div className="h-3 w-20 animate-pulse rounded bg-border-soft/60" />
          <div className="h-10 w-48 animate-pulse rounded bg-border-soft" />
          <div className="h-3 w-40 animate-pulse rounded bg-border-soft/50" />
        </div>
        <div className="mt-6 grid w-full grid-cols-3 gap-2 sm:gap-3">
          <div className="h-[88px] animate-pulse rounded-card border border-border-soft bg-canvas" />
          <div className="h-[88px] animate-pulse rounded-card border border-border-soft bg-canvas" />
          <div className="h-[88px] animate-pulse rounded-card border border-border-soft bg-canvas" />
        </div>
      </div>
    </div>
  );
}

function NotFound({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-card border border-border-soft bg-surface-raised p-5 text-center shadow-card-rest">
        <h1 className="font-display text-display-xs text-text-strong">
          We couldn&rsquo;t find {toDisplayName(name)}
        </h1>
        <p className="mt-2 max-w-md text-text-soft">
          The wallet may have been renamed, or you may not be a member.
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
