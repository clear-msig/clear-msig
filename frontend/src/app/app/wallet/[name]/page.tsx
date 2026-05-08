"use client";

// Wallet detail — retail rebuild (locked 2026-04-30).
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
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@/lib/wallet";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowLeft, ArrowRight, Banknote, Bell, ChevronDown, Coins, Download, Send, Settings as SettingsIcon, ShieldCheck, TrendingDown, Users } from "lucide-react";
import { WalletTourModal } from "@/components/onboarding/WalletTourModal";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { listIntents } from "@/lib/chain/intents";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { useRecentActivity, type RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useActionNeeded, type ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import { useTxAttempts } from "@/lib/hooks/useTxAttempts";
import type { TxAttempt } from "@/lib/retail/txLog";
import {
  buildActivityCsv,
  downloadActivityCsv,
} from "@/lib/retail/exportActivity";
import {
  useSolanaTxHistory,
  useEvmTxHistory,
  useBitcoinTxHistory,
  type ChainTxRow,
} from "@/lib/hooks/useChainTxHistory";
import {
  txUrl as solanaExplorerTxUrl,
  broadcastExplorerUrl,
} from "@/lib/explorer";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import {
  fetchErc20Holdings,
  tokenAmountToString,
  type Erc20Holding,
} from "@/lib/chain/erc20";


import { useBatchApprove } from "@/lib/hooks/useBatchApprove";
import { ProposalStatus } from "@/lib/msig";
import { Button } from "@/components/retail/Button";
import { BadgePill } from "@/components/retail/BadgePill";
import { MemberAvatarStack } from "@/components/retail/MemberAvatar";
import { StickyTopBar } from "@/components/retail/StickyTopBar";
import { QuickActionInput } from "@/components/retail/QuickActionInput";
import { relativeTime } from "@/lib/util/relativeTime";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { formatBalance } from "@/lib/retail/format";
import { avatarGradient } from "@/lib/retail/avatar";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import {
  getWalletAppearance,
  gradientFor,
  SHAPE_LABEL,
} from "@/lib/retail/walletAppearance";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { useWalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { formatUsd } from "@/lib/retail/priceConversion";
import { useDisplayCurrency } from "@/lib/hooks/useDisplayCurrency";
import { CHAIN_CATALOG as CHAIN_CATALOG_REF } from "@/lib/retail/chains";

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
  const displayName = useMemo(() => toDisplayName(name), [name]);
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
  const sendAttempts = useTxAttempts(name, 5);

  // Per-chain addresses for the tx-history sections below. Solana =
  // vault PDA (where execute_custom moves SOL from). EVM/BTC =
  // dWallet's chain-native address from the binding response.
  // Memoised so each history-query key only churns on wallet
  // change, not on every render.
  const solanaVaultAddress = useMemo(() => {
    if (!walletQuery.data) return null;
    const [vault] = findVaultAddress(
      walletQuery.data.pda,
      CLEAR_WALLET_PROGRAM_ID,
    );
    return vault.toBase58();
  }, [walletQuery.data]);
  const chainsQueryForHistory = useWalletChains(name);
  const evmAddress = useMemo(() => {
    const b = (chainsQueryForHistory.data?.chains ?? []).find(
      (c) => c.chain_kind === 1 || c.chain_kind === 4,
    );
    return b ? chainAddress(b) : null;
  }, [chainsQueryForHistory.data]);
  const btcAddress = useMemo(() => {
    const b = (chainsQueryForHistory.data?.chains ?? []).find(
      (c) => c.chain_kind === 2,
    );
    return b ? chainAddress(b) : null;
  }, [chainsQueryForHistory.data]);
  const solanaTxHistoryQuery = useSolanaTxHistory(solanaVaultAddress, 8);
  const evmTxHistoryQuery = useEvmTxHistory(evmAddress, 8);
  const btcTxHistoryQuery = useBitcoinTxHistory(btcAddress, 8);

  // ERC-20 holdings — every token the wallet's Sepolia address holds,
  // pulled from Blockscout. Drives the new Tokens-held panel below
  // so users can find a Send link without knowing the contract
  // address by heart.
  const erc20HoldingsQuery = useQuery({
    queryKey: ["erc20-holdings", evmAddress ?? ""],
    queryFn: () => fetchErc20Holdings(evmAddress!),
    enabled: !!evmAddress,
    staleTime: 60_000,
    refetchInterval: 90_000,
    retry: 1,
  });

  // Visible top-5 + the full filtered list for CSV export. Same
  // filter, two slice depths.
  const walletActivityAll = useMemo(
    () => allActivity.allRows.filter((r) => r.walletName === name),
    [allActivity.allRows, name],
  );
  const walletActivity = useMemo(
    () => walletActivityAll.slice(0, 5),
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
      {/* The "← Wallets" sticky bar floats below the HeaderBar with
          mostly-empty width on desktop, leaving a wide blank band
          above the hero. The sidebar already provides cross-wallet
          navigation on md+, so the back affordance is redundant
          there. Keep it on mobile where the sidebar lives behind a
          drawer and the back link is the only way out. */}
      <div className="md:hidden">
        <BackLink />
      </div>
      <Hero
        name={name}
        memberCount={memberCount}
        memberAddresses={memberAddresses}
        loadingMembers={intentsQuery.isLoading}
        balanceLamports={balanceQuery.data ?? null}
        loadingBalance={balanceQuery.isLoading}
        pendingApprovalCount={walletAction.length}
        reduce={!!reduce}
      />
      {/* Pending approvals come right after the hero — they're the
          single highest-priority action a wallet member can take.
          Always-visible, regardless of which tab is active, so a
          member with waiting proposals can't miss them by sitting
          on the Holdings tab. */}
      {walletAction.length > 0 && (
        <ActionNeededSection rows={walletAction} reduce={!!reduce} />
      )}
      <WalletDetailTabs
        // Activity tab data
        activityRows={walletActivity}
        activityAllRows={walletActivityAll}
        sendAttempts={sendAttempts}
        solanaHistory={solanaTxHistoryQuery.data ?? []}
        evmHistory={evmTxHistoryQuery.data ?? []}
        btcHistory={btcTxHistoryQuery.data ?? []}
        // Holdings tab data
        erc20Holdings={erc20HoldingsQuery.data ?? []}
        // Manage tab data
        name={name}
        hasIntents={hasIntents}
        memberCount={memberCount}
        loadingIntents={intentsQuery.isLoading}
        reduce={!!reduce}
      />
    </div>
  );
}

// ─── Tab nav ───────────────────────────────────────────────────────
//
// Phantom / Rainbow precedent: a wallet detail screen is a vertical
// dump in two ways — Hero on top, then a tabbed feed below. We
// already moved primary actions (Send / Receive / Policies) to the
// Hero tile row; the tabs here own the long-tail of content that
// previously stacked into 12 sections.
//
// Three tabs:
//   - Activity: pending approvals already render above; this tab
//     adds local send attempts, multisig proposal feed, and the
//     per-chain on-chain history.
//   - Holdings: the wallet's money. ERC-20 tokens today; future
//     home for a per-chain balance breakdown.
//   - Manage: NextSteps onboarding hints, weekly budget usage,
//     natural-language quick action, and the multi-action grid.
//
// Active tab persisted via URL hash (#activity / #holdings /
// #manage) so a refresh / back-nav lands on the same tab and the
// URL is shareable. Hash is intentionally cosmetic — the page
// renders correctly without it.

type WalletTab = "activity" | "holdings" | "manage";

interface WalletDetailTabsProps {
  activityRows: RecentActivityRow[];
  activityAllRows: RecentActivityRow[];
  sendAttempts: TxAttempt[];
  solanaHistory: ChainTxRow[];
  evmHistory: ChainTxRow[];
  btcHistory: ChainTxRow[];
  erc20Holdings: Erc20Holding[];
  name: string;
  /// Tri-state to match the upstream useMemo: null while the
  /// intents query is in flight, true/false once known. NextStepsStripe
  /// already handles the null case for its loading skeleton.
  hasIntents: boolean | null;
  memberCount: number | null;
  loadingIntents: boolean;
  reduce: boolean;
}

function WalletDetailTabs(props: WalletDetailTabsProps) {
  const {
    activityRows,
    activityAllRows,
    sendAttempts,
    solanaHistory,
    evmHistory,
    btcHistory,
    erc20Holdings,
    name,
    hasIntents,
    memberCount,
    loadingIntents,
    reduce,
  } = props;

  // Hash-driven tab selection. Lazy initializer so SSR keeps the
  // deterministic "activity" default and hydration matches the
  // first client render before the hashchange listener fires.
  const [tab, setTab] = useState<WalletTab>(() => {
    if (typeof window === "undefined") return "activity";
    const h = window.location.hash.replace(/^#/, "");
    if (h === "holdings" || h === "manage") return h;
    return "activity";
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onHash = () => {
      const h = window.location.hash.replace(/^#/, "");
      if (h === "holdings" || h === "manage") setTab(h);
      else setTab("activity");
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  // Tab-bar ref so a tab switch scrolls the user back to the bar's
  // top edge. Without this, switching from a deep-scrolled Activity
  // tab to the much shorter Holdings tab leaves the user mid-page on
  // empty content — the tap registers but reads as broken.
  const tabBarRef = useRef<HTMLDivElement>(null);
  const switchTab = (next: WalletTab) => {
    setTab(next);
    if (typeof window !== "undefined") {
      // Replace, not push — back-button in a wallet should leave
      // the wallet, not cycle through tabs the user already saw.
      const url =
        window.location.pathname +
        window.location.search +
        (next === "activity" ? "" : `#${next}`);
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
  // tabs in ActionNeededSection — no need to repeat them here.
  const holdingsCount = erc20Holdings.length;

  return (
    <>
      <TabBar
        ref={tabBarRef}
        tab={tab}
        onSelect={switchTab}
        counts={{ holdings: holdingsCount }}
      />

      {tab === "activity" && (
        <div className="flex flex-col gap-4">
          {/* Recent send attempts (success + failure). Persisted in
              localStorage so the user has a durable record of what
              happened — failed sends used to vanish with the toast. */}
          {sendAttempts.length > 0 && (
            <TxAttemptsSection rows={sendAttempts} reduce={reduce} />
          )}
          {/* Multisig proposal feed for this wallet. */}
          {activityRows.length > 0 ? (
            <ActivitySection
              rows={activityRows}
              allRows={activityAllRows}
              walletName={name}
              attempts={sendAttempts}
              reduce={reduce}
            />
          ) : (
            <ActivityEmptyState reduce={reduce} />
          )}
          {/* On-chain tx history per bound chain. The attempts log
              above only sees sends initiated from this browser; this
              shows everything that hit the address. */}
          {solanaHistory.length > 0 && (
            <ChainTxHistorySection
              rows={solanaHistory}
              chainTicker="SOL"
              chainKind={0}
              reduce={reduce}
            />
          )}
          {evmHistory.length > 0 && (
            <ChainTxHistorySection
              rows={evmHistory}
              chainTicker="ETH"
              chainKind={1}
              reduce={reduce}
            />
          )}
          {btcHistory.length > 0 && (
            <ChainTxHistorySection
              rows={btcHistory}
              chainTicker="BTC"
              chainKind={2}
              reduce={reduce}
            />
          )}
        </div>
      )}

      {tab === "holdings" && (
        <div className="flex flex-col gap-4">
          {erc20Holdings.length > 0 ? (
            <Erc20HoldingsSection
              walletName={name}
              rows={erc20Holdings}
              reduce={reduce}
            />
          ) : (
            <HoldingsEmptyState />
          )}
        </div>
      )}

      {tab === "manage" && (
        <div className="flex flex-col gap-4">
          <NextStepsStripe
            name={name}
            hasIntents={hasIntents}
            memberCount={memberCount}
            activityCount={activityRows.length}
            loading={loadingIntents}
          />
          <BudgetStripe name={name} />
          <QuickActionInput walletName={name} />
          <Actions name={name} hasIntents={hasIntents} reduce={reduce} />
        </div>
      )}
    </>
  );
}

interface TabBarProps {
  tab: WalletTab;
  onSelect: (next: WalletTab) => void;
  counts: { holdings: number };
}

const TabBar = forwardRef<HTMLDivElement, TabBarProps>(function TabBar(
  { tab, onSelect, counts },
  ref,
) {
  const items: {
    id: WalletTab;
    label: string;
    icon: React.ReactNode;
    count?: number;
  }[] = [
    {
      id: "activity",
      label: "Activity",
      icon: <Activity className="h-4 w-4" strokeWidth={2} />,
    },
    {
      id: "holdings",
      label: "Holdings",
      icon: <Coins className="h-4 w-4" strokeWidth={2} />,
      count: counts.holdings,
    },
    {
      id: "manage",
      label: "Manage",
      icon: <SettingsIcon className="h-4 w-4" strokeWidth={2} />,
    },
  ];

  return (
    <div
      ref={ref}
      role="tablist"
      aria-label="Wallet view"
      // Static placement — sticky would collide with the mobile-only
      // BackLink which also pins at top-20. The tabs are short enough
      // that a quick scroll-to-top via the browser swipe / bottom nav
      // still gets the user back to them; can revisit if real users
      // want them pinned. mt-2 gives it air from the hero card above
      // (gap-4 alone reads as flush).
      className="mt-2 mb-1 scroll-mt-24 print:hidden"
    >
      <div className="flex items-stretch gap-1 overflow-x-auto rounded-card border border-border-soft bg-surface-raised p-1 shadow-card-rest">
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
                "group inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft px-3 py-2 text-sm font-medium " +
                "transition-[background-color,color,transform] duration-base ease-out-soft " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
                (active
                  ? "bg-canvas text-text-strong shadow-card-rest"
                  : "text-text-soft hover:bg-canvas/50 hover:text-text-strong")
              }
            >
              <span
                className={
                  active ? "text-accent" : "text-text-soft group-hover:text-text-strong"
                }
              >
                {it.icon}
              </span>
              <span>{it.label}</span>
              {typeof it.count === "number" && it.count > 0 && (
                <span
                  className={
                    "ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[10px] font-semibold " +
                    (active
                      ? "bg-accent/15 text-accent"
                      : "bg-border-soft text-text-soft")
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

function HoldingsEmptyState() {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Coins className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-medium text-text-strong">No tokens yet</p>
      <p className="mt-1 text-xs text-text-soft">
        ERC-20 tokens this wallet holds appear here. SOL, ETH, BTC, and ZEC
        balances live on the wallet hero above.
      </p>
    </section>
  );
}

// ─── Top breadcrumb ────────────────────────────────────────────────

function BackLink() {
  return (
    <StickyTopBar offset="header">
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
    </StickyTopBar>
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
  pendingApprovalCount: number;
  reduce: boolean;
}


function Hero({
  name,
  memberCount,
  memberAddresses,
  loadingMembers,
  balanceLamports,
  loadingBalance,
  pendingApprovalCount,
  reduce,
}: HeroProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  const balance =
    balanceLamports !== null ? formatBalance(balanceLamports) : null;

  // Pull the picker output. Both fall back gracefully — wallets
  // created before the appearance store existed get the
  // deterministic gradient and no shape subtitle.
  const walletGrad = useMemo(
    () => gradientFor(name, avatarGradient(name)),
    [name],
  );
  const shapeLabel = useMemo(() => {
    const a = getWalletAppearance(name);
    return a?.shape ? SHAPE_LABEL[a.shape] : null;
  }, [name]);

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8"
    >
      {/* Inner stack capped to 2xl so headline + sub-line don't
          stretch the full 96rem workspace width on wide monitors.
          Without this, copy reads as a thin strip floating in a wide
          empty card on 1920+ displays. */}
      <div className="mx-auto flex max-w-2xl flex-col">
      {/* Header avatar — picks up the picker color from welcome.
          Gives the hub the same identity hook the sidebar shows so
          the user knows they're in the right wallet at a glance. */}
      <div className="mb-4 flex justify-center">
        <span
          aria-hidden="true"
          className={
            "flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br text-xl font-semibold text-white shadow-card-rest " +
            walletGrad.from +
            " " +
            walletGrad.to
          }
        >
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
      </div>
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        {shapeLabel ? `${shapeLabel} wallet` : "Shared wallet"}
      </p>
      <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
        {toHeadingName(name)}
      </h1>
      {/* Sub-line: shape preset + member count. Carries the create-
          time choice through to the hub so the user feels the wallet
          remembers what they set it up for. Sits right under the
          headline so identity copy reads as one block; the urgent
          "X waiting on you" pill lives below it (was wedged in
          between, breaking the rhythm). */}
      {shapeLabel && memberCount !== null && (
        <p className="mt-2 text-xs text-text-soft">
          For {shapeLabel.toLowerCase()} ·{" "}
          <span className="font-medium text-text-strong">{memberCount}</span>{" "}
          {memberCount === 1 ? "member" : "members"}
        </p>
      )}
      {/* Quiet pending-approvals pill. Anchors to the
          ActionNeededSection below for keyboard users; visible only
          when there's at least one approval waiting on this user. */}
      {pendingApprovalCount > 0 && (
        <a
          href="#action-needed"
          className="mx-auto mt-3 inline-flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.07] px-3 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/[0.12]"
        >
          <Bell className="h-3 w-3" strokeWidth={2.5} />
          {pendingApprovalCount} waiting on you
        </a>
      )}

      {/* Wallet value — total USD across every bound chain plus the
          per-chain breakdown. SOL stays as the primary tile so
          single-chain wallets feel the same; multi-chain wallets get
          the aggregate as the headline.
          Demo prices today (priceConversion.ts is a stub); the
          "demo prices" disclaimer keeps the UI honest. */}
      <PortfolioPanel walletName={name} fallbackBalance={balance} loadingFallback={loadingBalance} />

      {/* Hero footer A — meta row: members + settings. */}
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
      </div>

      {/* Hero footer B — primary action tiles. Replaces the
          three sub-tap-target pills (Send / Receive / Add policies)
          that read as decoration on the most-visited surface in
          the app. Tiles meet the 44px Apple HIG minimum and read
          as primary CTAs. mx-auto so the grid centers within the
          flex-col-items-center hero (text-center on a parent does
          not propagate to block-level grid children). */}
      <div
        className="mx-auto mt-4 grid w-full max-w-md grid-cols-3 gap-2"
        role="group"
        aria-label="Wallet actions"
      >
        <HeroActionTile
          href={`/app/wallet/${encodeURIComponent(name)}/send`}
          icon={<Send className="h-5 w-5" strokeWidth={1.75} />}
          label="Send"
        />
        <HeroActionTile
          href={`/app/wallet/${encodeURIComponent(name)}/receive`}
          icon={<Download className="h-5 w-5" strokeWidth={1.75} />}
          label="Receive"
        />
        <HeroActionTile
          href={`/app/wallet/${encodeURIComponent(name)}/policies`}
          icon={<ShieldCheck className="h-5 w-5" strokeWidth={1.75} />}
          label="Policies"
        />
      </div>
      </div>{/* end max-w-2xl Hero stack */}
    </motion.section>
  );
}

// Hero primary-action tile. ≥56px tap target, icon + label, accent
// hover lift. Lives in this file so the wallet hub remains a single
// vertical scan; the same pattern can be promoted to
// components/retail later if it shows up on a second surface.
function HeroActionTile({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex min-h-[56px] flex-col items-center justify-center gap-1 rounded-card border border-border-soft bg-canvas px-3 py-3 " +
        "text-xs font-medium text-text-strong " +
        "transition-[transform,border-color,box-shadow,color] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent hover:text-accent hover:shadow-card-rest " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      }
    >
      <span className="text-text-soft transition-colors duration-base ease-out-soft group-hover:text-accent">
        {icon}
      </span>
      <span>{label}</span>
    </Link>
  );
}

// ─── Portfolio (total USD + per-chain breakdown) ───────────────────
//
// Sums every bound chain's balance × demo USD price. SOL is always
// present; ETH/BTC/Zcash join when bound. Renders in the Hero in
// place of the SOL-only number, so single-chain wallets see no
// regression and multi-chain wallets get the aggregate they expect.
function PortfolioPanel({
  walletName,
  fallbackBalance,
  loadingFallback,
}: {
  walletName: string;
  fallbackBalance: { amount: string; ticker: string } | null;
  loadingFallback: boolean;
}) {
  const portfolio = useWalletPortfolio(walletName);
  const fiat = useDisplayCurrency();

  // Multi-chain check — only when a non-Solana chain has loaded.
  const hasMultipleChains =
    portfolio.breakdown.filter((c) => c.raw !== null && c.raw > 0n).length >
    1 || portfolio.breakdown.length > 1;

  if (!hasMultipleChains) {
    // Single-chain fallback: keep the existing SOL-only display so
    // wallets that haven't bound other chains feel identical to
    // before this change. Less noise, no demo-price disclaimer.
    return (
      <div className="mt-5">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
          Balance
        </p>
        {loadingFallback ? (
          <div className="mx-auto mt-1 h-9 w-40 animate-pulse rounded bg-border-soft" />
        ) : (
          <p className="mt-1 font-display text-display-xs text-text-strong">
            {fallbackBalance ? fallbackBalance.amount : "0"}{" "}
            <span className="text-text-strong/70">
              {fallbackBalance?.ticker ?? "SOL"}
            </span>
          </p>
        )}
      </div>
    );
  }

  const breakdownText = portfolio.breakdown
    .filter((c) => c.raw !== null)
    .map((c) => {
      const meta = chainByKindOnce(c.kind);
      if (!meta) return null;
      const amount = formatChainAmount(c.raw!, meta.smallestPerWhole, meta.displayDecimals);
      return `${amount} ${c.ticker}`;
    })
    .filter((s): s is string => s !== null)
    .join(" · ");

  return (
    <div className="mt-5">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
        Wallet value
      </p>
      {portfolio.isLoading && portfolio.totalUsd === 0 ? (
        <div className="mx-auto mt-1 h-9 w-40 animate-pulse rounded bg-border-soft" />
      ) : (
        <>
          <p className="mt-1 font-display text-display-xs text-text-strong">
            {fiat.format(portfolio.totalUsd)}
          </p>
          {breakdownText && (
            <p className="mt-1 text-xs text-text-soft">{breakdownText}</p>
          )}
          <p
            className="mt-1 text-[10px] text-text-soft/70"
            title="Prices are demo values today (priceConversion.ts is a stub). Treat as a sketch, not a quote."
          >
            demo prices
            {portfolio.unknownPriceChains.length > 0
              ? ` · no quote for ${portfolio.unknownPriceChains.join(", ")}`
              : ""}
          </p>
        </>
      )}
    </div>
  );
}

// Lookup the catalog row for a chain_kind. CHAIN_CATALOG itself is
// imported at the top of the file (alongside the other chain
// imports) — keep it that way; mid-file imports are not valid ES
// module syntax.
function chainByKindOnce(
  kind: number,
): { ticker: string; smallestPerWhole: bigint; displayDecimals: number } | null {
  const found = CHAIN_CATALOG_REF.find((c) => c.kind === kind);
  if (!found) return null;
  return {
    ticker: found.ticker,
    smallestPerWhole: found.smallestPerWhole,
    displayDecimals: found.displayDecimals,
  };
}

function formatChainAmount(
  raw: bigint,
  smallestPerWhole: bigint,
  displayDecimals: number,
): string {
  if (raw === 0n) return "0";
  const negative = raw < 0n;
  const abs = negative ? -raw : raw;
  const whole = abs / smallestPerWhole;
  const fraction = abs - whole * smallestPerWhole;
  if (displayDecimals === 0 || fraction === 0n) {
    return `${negative ? "-" : ""}${whole}`;
  }
  const wholeDigits = smallestPerWhole.toString().length - 1;
  const fracStr = fraction.toString().padStart(wholeDigits, "0");
  const truncated = fracStr.slice(0, displayDecimals).replace(/0+$/, "");
  if (truncated.length === 0) return `${negative ? "-" : ""}${whole}`;
  return `${negative ? "-" : ""}${whole}.${truncated}`;
}

// ─── Recent send attempts (success + failure log) ─────────────────
//
// Backed by localStorage via lib/retail/txLog. Surfaces what just
// happened so the user has durable proof of a successful send and
// a forensic trail for failures (raw stderr behind a "Show
// details" expander).

function TxAttemptsSection({
  rows,
  reduce,
}: {
  rows: TxAttempt[];
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">
          Recent send attempts
        </h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((row) => {
          const isOpen = expanded === row.id;
          const stamp = relativeTime(row.ts);
          return (
            <li key={row.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-strong">
                    {row.status === "success" ? (
                      <span className="text-accent">✓ </span>
                    ) : (
                      <span className="text-warning">! </span>
                    )}
                    {row.amountDisplay ?? "—"} {row.ticker ?? ""}
                    {row.recipientShort ? ` → ${row.recipientShort}` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-soft">
                    {stamp}
                    {row.status === "failed" && row.errorBrief
                      ? ` · ${row.errorBrief}`
                      : ""}
                  </p>
                </div>
                {row.status === "success" && row.explorerUrl ? (
                  <a
                    href={row.explorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 rounded-pill border border-border-soft bg-canvas px-3 py-1 text-[11px] font-medium text-text-strong transition hover:border-accent/50 hover:text-accent"
                  >
                    View tx ↗
                  </a>
                ) : row.status === "failed" && row.errorStderr ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    className="shrink-0 rounded-pill border border-border-soft bg-canvas px-3 py-1 text-[11px] font-medium text-text-strong transition hover:border-warning/50 hover:text-warning"
                  >
                    {isOpen ? "Hide details" : "Show details"}
                  </button>
                ) : null}
              </div>
              {row.status === "failed" && isOpen && row.errorStderr && (
                <pre className="mt-2 overflow-x-auto rounded-soft border border-border-soft bg-canvas px-3 py-2 text-[11px] leading-relaxed text-text-soft">
                  {row.errorStderr}
                </pre>
              )}
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}

// ─── On-chain tx history (per-chain) ───────────────────────────────
//
// Fetches actual chain-native activity for the wallet's address —
// incoming deposits + every spend, regardless of whether it came
// from this app. Complements the localStorage `TxAttemptsSection`
// (which only knows about sends initiated from this browser).

// ERC-20 holdings panel. Lists every token the wallet's Sepolia
// address owns; each row deep-links to /send/erc20?token=… so the
// user can act on the holding without finding the contract address.
// Hidden upstream when the array is empty.
function Erc20HoldingsSection({
  walletName,
  rows,
  reduce,
}: {
  walletName: string;
  rows: Erc20Holding[];
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">
          Tokens held (Sepolia)
        </h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((h) => {
          const display = tokenAmountToString(h.rawBalance, h.decimals, 6);
          const sendHref =
            `/app/wallet/${encodeURIComponent(walletName)}/send/erc20` +
            `?token=${encodeURIComponent(h.contractAddress)}`;
          return (
            <li
              key={h.contractAddress}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-[11px] font-semibold uppercase text-accent">
                {h.symbol.slice(0, 3)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-strong">
                  {h.name}
                  <span className="ml-1.5 text-xs font-normal text-text-soft">
                    ({h.symbol})
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs tabular-nums text-text-soft">
                  {display} {h.symbol}
                </p>
              </div>
              <Link
                href={sendHref}
                className={
                  "shrink-0 inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-3 py-1 text-[11px] font-medium text-text-soft " +
                  "transition-[border-color,color,transform] duration-base ease-out-soft " +
                  "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                }
              >
                Send
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            </li>
          );
        })}
      </ul>
    </motion.section>
  );
}

function ChainTxHistorySection({
  rows,
  chainTicker,
  chainKind,
  reduce,
}: {
  rows: ChainTxRow[];
  chainTicker: string;
  chainKind: number;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">
          On-chain activity ({chainTicker})
        </h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((row) => {
          const stamp =
            row.ts !== null
              ? relativeTime(row.ts * 1000)
              : `slot ${row.slot}`;
          const shortSig = `${row.txId.slice(0, 6)}…${row.txId.slice(-6)}`;
          const failed = row.status === "failed";
          return (
            <li key={row.txId} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-strong">
                    {failed ? (
                      <span className="text-warning">! </span>
                    ) : (
                      <span className="text-accent">✓ </span>
                    )}
                    <span className="font-mono text-xs">{shortSig}</span>
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-soft">
                    {stamp}
                    {failed && row.errorBrief ? ` · ${row.errorBrief}` : ""}
                    {!failed && row.status === "confirmed"
                      ? " · confirmed"
                      : ""}
                  </p>
                </div>
                <a
                  href={
                    chainKind === 0
                      ? solanaExplorerTxUrl(row.txId)
                      : broadcastExplorerUrl({
                          chain_kind: chainKind,
                          tx_id: row.txId,
                        }) ?? "#"
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 rounded-pill border border-border-soft bg-canvas px-3 py-1 text-[11px] font-medium text-text-strong transition hover:border-accent/50 hover:text-accent"
                >
                  View ↗
                </a>
              </div>
            </li>
          );
        })}
      </ul>
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
      transition={{ duration: 0.2 }}
      className="grid grid-cols-1 gap-3 sm:grid-cols-2"
    >
      {sendingReady ? (
        <Link href={`/app/wallet/${encoded}/send`} className="block">
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

      {/* Fiat ramping (NGN ↔ crypto) — second-tier actions, sit
          beneath the primary Send/Receive row so they're discoverable
          without competing with the everyday flow. */}
      <Link href={`/app/wallet/${encoded}/buy`} className="block">
        <Button size="lg" variant="secondary" fullWidth>
          <Banknote className="h-4 w-4" aria-hidden="true" />
          Buy with naira
        </Button>
      </Link>
      <Link href={`/app/wallet/${encoded}/sell`} className="block">
        <Button size="lg" variant="secondary" fullWidth>
          <TrendingDown className="h-4 w-4" aria-hidden="true" />
          Sell to bank
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
      id="action-needed"
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest scroll-mt-24"
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
            <BadgePill onClick={handleApproveAll} disabled={running}>
              {running ? "Approving…" : "Approve all"}
            </BadgePill>
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

// ─── Recent activity (filtered to this wallet) ─────────────────────

interface ActivityProps {
  rows: RecentActivityRow[];
  /// Full unsliced list for this wallet — used by the CSV export
  /// so accountants get the complete history, not just the visible
  /// top-5 the dashboard renders.
  allRows: RecentActivityRow[];
  walletName: string;
  attempts: TxAttempt[];
  reduce: boolean;
}

function ActivitySection({
  rows,
  allRows,
  walletName,
  attempts,
  reduce,
}: ActivityProps) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  // Per-wallet collapsed flag in localStorage so the user's choice
  // sticks across page nav. Default expanded — recent activity is
  // the most-glanced-at section after Pending approvals.
  const collapsedKey = `clear.activity-collapsed.${walletName}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(collapsedKey) === "1";
    } catch {
      return false;
    }
  });
  const toggleCollapsed = () => {
    const next = !collapsed;
    setCollapsed(next);
    try {
      window.localStorage.setItem(collapsedKey, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  };
  const handleExport = () => {
    const csv = buildActivityCsv({
      walletName,
      rows: allRows,
      attempts,
    });
    const slug = walletName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadActivityCsv(`clear-msig-${slug || "wallet"}-${stamp}.csv`, csv);
  };
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="recent-activity-list"
          className={
            "group inline-flex items-center gap-1.5 rounded-soft px-1 py-0.5 -mx-1 " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ChevronDown
            className={
              "h-3.5 w-3.5 text-text-soft transition-transform duration-base " +
              (collapsed ? "-rotate-90" : "rotate-0")
            }
            strokeWidth={2.5}
            aria-hidden="true"
          />
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
            Recent activity
          </span>
          <span className="text-[10px] tabular-nums text-text-soft/70">
            {allRows.length}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          {!collapsed && allRows.length > rows.length && (
            <Link
              href={`/app/wallet/${encodeURIComponent(walletName)}/activity`}
              className={
                "inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-soft " +
                "transition-[border-color,color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
              title="See every proposal with chain + status filters"
            >
              See all
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
          )}
          {!collapsed && allRows.length > 0 && (
            <button
              type="button"
              onClick={handleExport}
              className={
                "inline-flex items-center gap-1 rounded-full border border-border-soft bg-surface-raised px-2.5 py-1 text-[11px] font-medium text-text-soft " +
                "transition-[border-color,color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
              title="Download every proposal on this wallet as CSV"
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              Export CSV
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <ul
          id="recent-activity-list"
          className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest"
        >
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
                    {relativeTime(row.proposedAt)}
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
      )}
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
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <h2 className="text-xs font-medium uppercase tracking-[0.18em] text-text-soft">
        Activity
      </h2>
      {/* Ghost row — same shape as a real activity row, just muted.
          Cash App pattern: tell the user what this surface looks like
          when it has content, so the empty state isn't a void. */}
      <div className="mt-3 flex items-center gap-3 rounded-soft border border-dashed border-border-soft px-3 py-3">
        <div className="h-8 w-8 shrink-0 rounded-full bg-border-soft/40" />
        <div className="min-w-0 flex-1">
          <div className="h-2.5 w-32 rounded bg-border-soft/40" />
          <div className="mt-2 h-2 w-20 rounded bg-border-soft/30" />
        </div>
      </div>
      <p className="mt-3 text-sm text-text-strong">
        Your first send or invite shows up here.
      </p>
      <p className="mt-1 text-xs text-text-soft">
        Every move on this wallet — sent, approved, declined — gets a
        row, with the friend who acted and when.
      </p>
    </motion.section>
  );
}

// ─── Loading + not-found ───────────────────────────────────────────

// Geometry-matched detail skeleton — Hero (status chip, headline,
// sub-line, portfolio tile, member row, 3-up action tile row) +
// Actions card. The previous version was a generic 3-stripe block
// that left ~250px of layout shift when the real Hero swapped in.
function DetailSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-6">
      {/* Sticky-bar back link placeholder. */}
      <div className="-ml-2 h-7 w-24 animate-pulse rounded bg-border-soft" />

      {/* Hero card. Centered column to match the real Hero. */}
      <div className="flex flex-col items-center rounded-card border border-border-soft bg-surface-raised p-6 text-center shadow-card-rest sm:p-8">
        {/* Status chip. */}
        <div className="h-6 w-32 animate-pulse rounded-full bg-border-soft/60" />
        {/* Headline (font-display text-display-sm). */}
        <div className="mt-3 h-9 w-3/4 animate-pulse rounded bg-border-soft" />
        {/* Sub-line. */}
        <div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-border-soft/70" />
        {/* Portfolio panel — label + headline + breakdown line. */}
        <div className="mt-5 flex w-full max-w-xs flex-col items-center gap-2">
          <div className="h-3 w-20 animate-pulse rounded bg-border-soft/60" />
          <div className="h-8 w-32 animate-pulse rounded bg-border-soft" />
          <div className="h-3 w-40 animate-pulse rounded bg-border-soft/50" />
        </div>
        {/* Members row. */}
        <div className="mt-5 flex items-center gap-2">
          <div className="flex -space-x-2">
            <div className="h-7 w-7 animate-pulse rounded-full border-2 border-surface-raised bg-border-soft" />
            <div className="h-7 w-7 animate-pulse rounded-full border-2 border-surface-raised bg-border-soft/80" />
            <div className="h-7 w-7 animate-pulse rounded-full border-2 border-surface-raised bg-border-soft/60" />
          </div>
          <div className="h-4 w-20 animate-pulse rounded bg-border-soft/60" />
        </div>
        {/* 3-up Hero action tiles — mx-auto matches the live Hero. */}
        <div className="mx-auto mt-4 grid w-full max-w-md grid-cols-3 gap-2">
          <div className="h-[56px] animate-pulse rounded-card border border-border-soft bg-canvas" />
          <div className="h-[56px] animate-pulse rounded-card border border-border-soft bg-canvas" />
          <div className="h-[56px] animate-pulse rounded-card border border-border-soft bg-canvas" />
        </div>
      </div>

      {/* Quick actions card — 2-up grid below the hero. */}
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
          We couldn&rsquo;t find {toDisplayName(name)}
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

// ─── Next Steps stripe ─────────────────────────────────────────────
//
// Surfaces the most useful single next move based on what the wallet
// is missing. Picks one of three:
//
//   - No spending rule yet → enable sending
//   - Rule but only the connected user → invite someone
//   - Rule + members + zero activity → send the first request
//
// We render at most one nudge so the wallet hub stays calm. Once
// activity exists OR the wallet is fully fleshed out, the stripe
// goes away entirely. Loading state hides it (avoids flash of
// "Set up sending" while data is in flight).

interface NextStepsStripeProps {
  name: string;
  hasIntents: boolean | null;
  memberCount: number | null;
  activityCount: number;
  loading: boolean;
}

function NextStepsStripe({
  name,
  hasIntents,
  memberCount,
  activityCount,
  loading,
}: NextStepsStripeProps) {
  if (loading || hasIntents === null) return null;

  const encoded = encodeURIComponent(name);
  let nudge:
    | {
        title: string;
        body: string;
        cta: string;
        href: string;
      }
    | null = null;

  const display = toDisplayName(name);
  if (!hasIntents) {
    nudge = {
      title: "Set up sending",
      body: `${display} can't send money yet. Enable sending. Takes about 1 minute and 2 wallet popups.`,
      cta: "Enable sending",
      href: `/app/wallet/${encoded}/setup`,
    };
  } else if ((memberCount ?? 0) <= 1) {
    nudge = {
      title: "Invite someone",
      body: "You're the only signer right now. Add a friend, teammate, or board member so requests get a second look.",
      cta: "Add someone",
      href: `/app/wallet/${encoded}/members/add`,
    };
  } else if (activityCount === 0) {
    nudge = {
      title: "Send your first request",
      body: `${display} is set up and has signers. Make the first send to put the rule into practice.`,
      cta: "Send a request",
      href: `/app/wallet/${encoded}/send`,
    };
  }

  if (!nudge) return null;

  return (
    <section
      aria-label="Next step"
      className="rounded-card border border-accent/40 bg-accent/[0.10] p-4 shadow-card-rest sm:p-5"
    >
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-accent">
            Next step · {display}
          </p>
          <p className="mt-1 font-display text-base text-text-strong">
            {nudge.title}
          </p>
          <p className="mt-1 text-sm text-text-soft">{nudge.body}</p>
        </div>
        <Link
          href={nudge.href}
          className={
            "inline-flex shrink-0 items-center gap-1.5 self-stretch rounded-soft bg-accent px-4 py-2 text-sm font-medium text-white shadow-accent-rest sm:self-auto " +
            "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          {nudge.cta}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}


// ─── Budget stripe ─────────────────────────────────────────────────
//
// Compact tracker showing this-week spending vs the wallet's
// weekly cap. Renders only when a cap is set; otherwise we let the
// /budget page's own empty-state-with-CTA do the work. Keeps the
// hub from filling up with promotional surfaces.

function BudgetStripe({ name }: { name: string }) {
  const usage = useWalletBudgetUsage(name);
  if (usage.loading) return null;
  const cap = usage.budget?.weeklyUsd ?? null;
  const cappedChains = usage.perChain.filter((c) => c.cap !== null);
  const velocityCap = usage.budget?.velocityPerDay ?? null;
  // Render the stripe if ANY policy field is set; v1 only checked
  // the wallet-wide cap, v2 also surfaces per-chain + velocity.
  if (
    (cap === null || cap === undefined) &&
    cappedChains.length === 0 &&
    !velocityCap
  ) {
    return null;
  }

  // No-limit case — saved as null. The render-gate above already
  // filters this; defensive belt-and-braces in case the storage
  // shape evolves.
  if (cap === 0) {
    return (
      <Link
        href={`/app/wallet/${encodeURIComponent(name)}/budget`}
        className="rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-xs text-text-soft shadow-card-rest hover:text-text-strong"
      >
        Weekly cap is $0. Every send needs full approval. Edit →
      </Link>
    );
  }

  // The stripe always renders something now that any of three rules
  // can be in play. Wallet-wide block only when cap is positive;
  // otherwise the header reads "Spending policy" and we lead with
  // per-chain or velocity.
  const hasWalletCap = cap !== null && cap > 0;
  const pct = usage.pctUsed ?? 0;
  const over = hasWalletCap && pct >= 1;
  const tone = over ? "danger" : pct >= 0.8 && hasWalletCap ? "warning" : "accent";
  return (
    <Link
      href={`/app/wallet/${encodeURIComponent(name)}/budget`}
      className={
        "block rounded-card border bg-surface-raised p-4 shadow-card-rest transition-[border-color,transform] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/40 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
        (over
          ? "border-danger/30"
          : hasWalletCap && pct >= 0.8
            ? "border-warning/30"
            : "border-border-soft")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={"text-xs font-medium uppercase tracking-[0.18em] text-" + tone}>
          {over
            ? "Over weekly limit"
            : hasWalletCap
              ? "Weekly limit"
              : "Spending policy"}
        </p>
        <p className="text-xs text-text-soft">
          {usage.proposalCount} {usage.proposalCount === 1 ? "send" : "sends"} this week
          {velocityCap
            ? ` · ${usage.sendsLast24h} of ${velocityCap} today`
            : ""}
        </p>
      </div>
      {hasWalletCap && (
        <>
      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="font-display text-base text-text-strong">
          {formatUsd(usage.spentUsd)}{" "}
          <span className="text-text-soft">of {formatUsd(cap)}</span>
        </p>
        <p className={"text-xs " + (over ? "text-danger" : "text-text-soft")}>
          {usage.remainingUsd !== null && usage.remainingUsd >= 0
            ? `${formatUsd(usage.remainingUsd)} left`
            : `${formatUsd(Math.abs(usage.remainingUsd ?? 0))} over`}
        </p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border-soft"
        role="progressbar"
        aria-valuenow={Math.round(pct * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          style={{ width: `${Math.min(100, Math.round(pct * 100))}%` }}
          className={
            "h-full transition-[width] duration-base ease-out-soft " +
            (over ? "bg-danger" : pct >= 0.8 ? "bg-warning" : "bg-accent")
          }
        />
      </div>
        </>
      )}
      {cappedChains.length > 0 && (
        <ul className="mt-3 flex flex-col gap-2 border-t border-border-soft pt-3">
          {cappedChains.map((c) => {
            const chainCap = c.cap;
            if (chainCap === null) return null;
            const chainPct = c.pctUsed ?? 0;
            const chainOver = chainPct >= 1;
            return (
              <li key={c.ticker}>
                <div className="flex items-baseline justify-between gap-2 text-[11px] text-text-soft">
                  <span className="font-medium text-text-strong">{c.ticker}</span>
                  <span className={chainOver ? "text-danger" : ""}>
                    {formatUsd(c.spentUsd)} of {formatUsd(chainCap)}
                  </span>
                </div>
                <div
                  className="mt-1 h-1 overflow-hidden rounded-full bg-border-soft"
                  role="progressbar"
                  aria-valuenow={Math.round(chainPct * 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    style={{ width: `${Math.min(100, Math.round(chainPct * 100))}%` }}
                    className={
                      "h-full transition-[width] duration-base ease-out-soft " +
                      (chainOver
                        ? "bg-danger"
                        : chainPct >= 0.8
                          ? "bg-warning"
                          : "bg-accent")
                    }
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Link>
  );
}

