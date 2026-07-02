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
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection, useWallet } from "@/lib/wallet";
import { proposerDisplayName } from "@/lib/retail/proposerName";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowRight, Banknote, Bell, Bot, ChevronDown, Coins, Download, Eye, EyeOff, FileCheck2, Heart, Network, PauseCircle, ReceiptText, Repeat2, Send, Settings as SettingsIcon, ShieldCheck, TrendingDown, Users, type LucideIcon } from "lucide-react";
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
  useZcashTxHistory,
  type ChainTxRow,
} from "@/lib/hooks/useChainTxHistory";
import {
  txUrl as solanaExplorerTxUrl,
  broadcastExplorerUrl,
} from "@/lib/explorer";
import { useWalletChains, chainAddress } from "@/lib/hooks/useWalletChains";
import { useSendChains } from "@/lib/hooks/useSendChains";
import {
  chainSendActionLabel,
  type ChainSendStatus,
} from "@/lib/chain/send-support";
import {
  fetchErc20Holdings,
  tokenAmountToString,
  type Erc20Holding,
} from "@/lib/chain/erc20";


import { useBatchApprove } from "@/lib/hooks/useBatchApprove";
import { ProposalStatus } from "@/lib/msig";
import { Button } from "@/components/retail/Button";
import { BadgePill } from "@/components/retail/BadgePill";
import { BalanceCardPattern } from "@/components/retail/BalanceCardPattern";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { MemberAvatarStack } from "@/components/retail/MemberAvatar";
import { WalletAvatar } from "@/components/retail/WalletAvatar";
import { relativeTime } from "@/lib/util/relativeTime";
import { friendlyIntentLabel, friendlyStatus, statusTextColor } from "@/lib/retail/labels";
import {
  activityGroupTitle,
  groupRecentActivityRows,
} from "@/lib/retail/activityGroups";
import { formatBalance } from "@/lib/retail/format";
import { toDisplayName, toHeadingName } from "@/lib/retail/walletNames";
import {
  getWalletAppearance,
  saveWalletAppearance,
  SHAPE_LABEL,
} from "@/lib/retail/walletAppearance";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import { useWalletPortfolio } from "@/lib/hooks/useWalletPortfolio";
import { useBalancePrivacy } from "@/lib/hooks/useBalancePrivacy";
import { useContacts } from "@/lib/hooks/useContacts";
import {
  isValidSolanaAddress,
  shortAddress,
} from "@/lib/retail/contacts";
import { formatUsd } from "@/lib/retail/priceConversion";
import {
  getEmergencyPause,
  saveEmergencyPause,
} from "@/lib/retail/policy";
import {
  getSpendingCategories,
  saveSpendingCategories,
  type SpendingCategory,
} from "@/lib/retail/spendingCategories";
import {
  listPersonalReceipts,
  recordPersonalReceipt,
  type PersonalReceipt,
} from "@/lib/retail/personalReceipts";
import { useDisplayCurrency } from "@/lib/hooks/useDisplayCurrency";
import { UsdHint } from "@/components/retail/UsdHint";
import { InfoTip } from "@/components/retail/InfoTip";
import { CHAIN_CATALOG as CHAIN_CATALOG_REF } from "@/lib/retail/chains";
import { appConfig } from "@/lib/config";
import {
  buildProAccountingCsv,
  downloadProAccountingCsv,
  getProTreasuryRuntime,
  useProSchedules,
  type ProSchedule,
} from "@/lib/pro/treasury";
import { loadEmailPrefs } from "@/lib/security/emailNotifications";
import { loadWebhookPrefs } from "@/lib/security/webhookNotifications";
import {
  isProductSurfaceId,
  type ProductSurfaceId,
} from "@/lib/productSurfaces";
import { productSurfaceIcon } from "@/lib/productIcons";
import { resolveWalletProductSurface } from "@/lib/productWorkspace";

type WalletTab = "activity" | "holdings" | "manage";
const WALLET_TAB_ORDER: WalletTab[] = ["holdings", "activity", "manage"];

function readWalletTabFromHash(): WalletTab {
  if (typeof window === "undefined") return "holdings";
  const h = window.location.hash.replace(/^#/, "");
  if (h === "activity" || h === "manage") return h;
  return "holdings";
}

function useProductSurfaceIntent(): ProductSurfaceId | null {
  const [surface, setSurface] = useState<ProductSurfaceId | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const requested = new URLSearchParams(window.location.search).get("surface");
    setSurface(isProductSurfaceId(requested) ? requested : null);
  }, []);

  return surface;
}

function useWalletProductSurface(walletName: string): ProductSurfaceId | null {
  const requestedSurface = useProductSurfaceIntent();
  const [storedSurface, setStoredSurface] = useState<ProductSurfaceId | null>(null);

  useEffect(() => {
    const appearance = getWalletAppearance(walletName);
    const surface = isProductSurfaceId(appearance?.surface)
      ? appearance.surface
      : resolveWalletProductSurface(walletName);
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
  const [loadChainHistory, setLoadChainHistory] = useState(false);
  const productSurface = useWalletProductSurface(name);

  useEffect(() => {
    if (detailTab !== "activity") return;
    if (loadChainHistory) return;
    if (typeof window === "undefined") return;

    const idle = window.requestIdleCallback;
    if (typeof idle === "function") {
      const handle = idle(() => setLoadChainHistory(true), { timeout: 1_000 });
      return () => window.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(() => setLoadChainHistory(true), 600);
    return () => window.clearTimeout(handle);
  }, [detailTab, loadChainHistory]);

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
      (c) => c.chain_kind === 1 || c.chain_kind === 4 || c.chain_kind === 5,
    );
    return b ? chainAddress(b) : null;
  }, [chainsQueryForHistory.data]);
  const btcAddress = useMemo(() => {
    const b = (chainsQueryForHistory.data?.chains ?? []).find(
      (c) => c.chain_kind === 2,
    );
    return b ? chainAddress(b) : null;
  }, [chainsQueryForHistory.data]);
  const zcashAddress = useMemo(() => {
    const b = (chainsQueryForHistory.data?.chains ?? []).find(
      (c) => c.chain_kind === 3,
    );
    return b ? chainAddress(b) : null;
  }, [chainsQueryForHistory.data]);
  const chainHistoryEnabled = detailTab === "activity" && loadChainHistory;
  const solanaTxHistoryQuery = useSolanaTxHistory(solanaVaultAddress, 8, {
    enabled: chainHistoryEnabled,
  });
  const evmTxHistoryQuery = useEvmTxHistory(evmAddress, 8, {
    enabled: chainHistoryEnabled,
  });
  const btcTxHistoryQuery = useBitcoinTxHistory(btcAddress, 8, {
    enabled: chainHistoryEnabled,
  });
  const zcashTxHistoryQuery = useZcashTxHistory(
    zcashAddress,
    appConfig.preAlpha.zcashRpcUrl,
    8,
    { enabled: chainHistoryEnabled },
  );

  // ERC-20 holdings - every token the wallet's Sepolia address holds,
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
      <Hero
        name={name}
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
        <ActionNeededSection rows={walletAction} reduce={!!reduce} />
      )}
      <WalletDetailTabs
        tab={detailTab}
        onTabChange={setDetailTab}
        // Activity tab data
        activityRows={walletActivity}
        activityAllRows={walletActivityAll}
        sendAttempts={sendAttempts}
        solanaHistory={solanaTxHistoryQuery.data ?? []}
        evmHistory={evmTxHistoryQuery.data ?? []}
        btcHistory={btcTxHistoryQuery.data ?? []}
        zcashHistory={zcashTxHistoryQuery.data ?? []}
        // Holdings tab data
        erc20Holdings={erc20HoldingsQuery.data ?? []}
        // Manage tab data
        name={name}
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
  solanaHistory: ChainTxRow[];
  evmHistory: ChainTxRow[];
  btcHistory: ChainTxRow[];
  zcashHistory: ChainTxRow[];
  erc20Holdings: Erc20Holding[];
  name: string;
  productSurface: ProductSurfaceId | null;
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
    solanaHistory,
    evmHistory,
    btcHistory,
    zcashHistory,
    erc20Holdings,
    name,
    productSurface,
    actionRows,
    hasIntents,
    reduce,
  } = props;
  const portfolio = useWalletPortfolio(name);

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
  const holdingsCount = portfolio.breakdown.length + erc20Holdings.length;

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
        <div className="flex flex-col gap-4">
          {/* Recent send attempts (success + failure). Persisted in
              localStorage so the user has a durable record of what
              happened - failed sends used to vanish with the toast. */}
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
            <ActivityEmptyState walletName={name} reduce={reduce} />
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
          {zcashHistory.length > 0 && (
            <ChainTxHistorySection
              rows={zcashHistory}
              chainTicker="ZEC"
              chainKind={3}
              reduce={reduce}
            />
          )}
        </div>
      )}

      {tab === "holdings" && (
        <div className="flex flex-col gap-4">
          <NativeHoldingsSection
            walletName={name}
            rows={portfolio.breakdown}
            loading={portfolio.isLoading}
            reduce={reduce}
          />
          {erc20Holdings.length > 0 ? (
            <Erc20HoldingsSection
              walletName={name}
              rows={erc20Holdings}
              reduce={reduce}
            />
          ) : null}
        </div>
      )}

      {tab === "manage" && (
        <div className="flex flex-col gap-4">
          {productSurface === "pro" ? (
            <ProOperationsPanel
              name={name}
              actionRows={actionRows}
              activityRows={activityAllRows}
              attempts={sendAttempts}
              reduce={reduce}
            />
          ) : null}
          {productSurface === "pro" ? <BudgetStripe name={name} /> : null}
          {productSurface !== "pro" || hasIntents === false ? (
            <Actions
              name={name}
              productSurface={productSurface}
              hasIntents={hasIntents}
              reduce={reduce}
            />
          ) : null}
        </div>
      )}
    </>
  );
}

interface TabBarProps {
  productSurface: ProductSurfaceId | null;
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

function tabLabelsFor(surface: ProductSurfaceId | null): Record<WalletTab, string> {
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

function HoldingsEmptyState({ walletName }: { walletName: string }) {
  const encoded = encodeURIComponent(walletName);
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Coins className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-medium text-text-strong">No tokens yet</p>
      <p className="mt-1 text-xs text-text-soft">
        Activated assets and token balances appear here once the wallet is ready.
      </p>
      <Link
        href={`/app/wallet/${encoded}/receive`}
        className={
          "mt-4 inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
          "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        }
      >
        Receive money
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </section>
  );
}

// ─── Next best action ──────────────────────────────────────────────
//
// Retail dashboard rule: the first screen should tell the user what
// matters now. This card deliberately sits between the money hero and
// the tabbed detail feed so a user does not need to inspect Activity,
// Holdings, and Manage just to find their next move.

function NativeHoldingsSection({
  walletName,
  rows,
  loading,
  reduce,
}: {
  walletName: string;
  rows: ReturnType<typeof useWalletPortfolio>["breakdown"];
  loading: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(walletName);
  const readiness = useSendChains(walletName);
  const readinessByKind = useMemo(() => {
    const map = new Map<number, (typeof readiness.options)[number]>();
    for (const option of readiness.options) map.set(option.chain.kind, option);
    return map;
  }, [readiness]);

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <header className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium text-text-strong">
            Assets
          </h2>
        </div>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>

      {rows.length === 0 ? (
        <div className="mt-4">
          <HoldingsEmptyState walletName={walletName} />
        </div>
      ) : (
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {rows.map((row) => {
            const meta = CHAIN_CATALOG_REF.find((c) => c.kind === row.kind);
            const sendStatus = readinessByKind.get(row.kind)?.status ?? null;
            const amount =
              row.raw !== null && meta
                ? formatChainAmount(
                    row.raw,
                    meta.smallestPerWhole,
                    meta.displayDecimals,
                  )
                : null;
            const sendHref =
              meta && sendStatus
                ? nativeHoldingSendHref(
                    encoded,
                    row.kind,
                    meta.apiName,
                    sendStatus,
                  )
                : null;
            const receiveHref = meta
              ? `/app/wallet/${encoded}/receive?chain=${encodeURIComponent(meta.apiName)}`
              : `/app/wallet/${encoded}/receive`;
            return (
              <li
                key={row.kind}
                className="flex min-w-0 items-center gap-3 rounded-soft border border-border-soft bg-canvas/70 p-3"
              >
                {meta ? (
                  <ChainBadge chain={meta} size="md" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-zinc-600 to-zinc-400 text-xs font-semibold text-white"
                  >
                    {row.ticker.slice(0, 1)}
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-medium text-text-strong">
                      {row.name}
                    </p>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] text-text-soft">
                      {row.ticker}
                    </span>
                  </div>
                  <p className="mt-0.5 font-numerals text-sm tabular-nums text-text-soft">
                    {amount ?? (loading ? "Reading balance" : "Check network balance")}
                    {amount ? ` ${row.ticker}` : ""}
                    {typeof row.usd === "number" ? (
                      <span className="ml-1.5 text-xs text-text-soft/80">
                        {formatUsd(row.usd)}
                      </span>
                    ) : null}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Link
                    href={receiveHref}
                    aria-label={`Receive ${row.ticker}`}
                    title={`Receive ${row.ticker}`}
                    className={
                      "inline-flex min-h-9 items-center justify-center rounded-full border border-border-soft bg-surface-raised px-2.5 text-[11px] font-medium text-text-strong " +
                      "transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent " +
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                    }
                  >
                    Receive
                  </Link>
                  {sendHref ? (
                    <Link
                      href={sendHref}
                      aria-label={`Send ${row.ticker}`}
                      title={`Send ${row.ticker}`}
                      className={
                        "inline-flex min-h-9 items-center justify-center rounded-full border border-border-soft bg-surface-raised px-2.5 text-[11px] font-medium text-text-strong " +
                        "transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent " +
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                      }
                    >
                      {sendStatus ? chainSendActionLabel(sendStatus) : "Send"}
                    </Link>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </motion.section>
  );
}

function nativeHoldingSendHref(
  encodedWalletName: string,
  kind: number,
  apiName: string,
  status: ChainSendStatus,
): string | null {
  if (status === "coming_soon") return null;
  if (status === "needs_binding") {
    return `/app/wallet/${encodedWalletName}/chains/add?chain=${encodeURIComponent(apiName)}&autostart=1`;
  }
  if (kind === 0) return `/app/wallet/${encodedWalletName}/send`;
  if (kind === 1) {
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/setup/eth?autostart=1`
      : `/app/wallet/${encodedWalletName}/send/eth`;
  }
  if (kind === 2) {
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/send/btc?autostart=1`
      : `/app/wallet/${encodedWalletName}/send/btc`;
  }
  if (kind === 3) {
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/send/zec?autostart=1`
      : `/app/wallet/${encodedWalletName}/send/zec`;
  }
  if (kind === 5) {
    return status === "needs_setup"
      ? `/app/wallet/${encodedWalletName}/setup/eth?network=hyperliquid&autostart=1`
      : `/app/wallet/${encodedWalletName}/send/eth?network=hyperliquid`;
  }
  return null;
}

// ─── Hero card ─────────────────────────────────────────────────────

interface HeroProps {
  name: string;
  productSurface: ProductSurfaceId | null;
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
  productSurface,
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

  const shapeLabel = useMemo(() => {
    const a = getWalletAppearance(name);
    return a?.shape ? SHAPE_LABEL[a.shape] : null;
  }, [name]);

  const encoded = encodeURIComponent(name);
  const profile = productHeroProfile(productSurface, shapeLabel);
  const heroActions = productHeroActions(productSurface, encoded);
  const { hidden: balancesHidden, toggle: toggleBalancesHidden } =
    useBalancePrivacy();

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-3 sm:gap-5"
    >
      {/* ── Page header strip ───────────────────────────────────
          Mirrors the secure / account / wizard headers. Mono
          eyebrow + display-sm title + chips row. So the workspace
          reads as one product surface. Avatar disc anchors the
          identity inline; chips on the trailing edge surface
          members + pending approvals at a glance. */}
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 sm:gap-x-5 sm:gap-y-3">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <WalletAvatar
            name={name}
            size="lg"
            shapeClass={profile.avatarClass}
            icon={profile.avatarIcon}
          />
          <div className="flex min-w-0 flex-col">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              {profile.eyebrow}
            </p>
            <h1 className="mt-0.5 truncate font-display text-xl leading-tight text-text-strong sm:mt-1 sm:text-display-xs">
              {toHeadingName(name)}
            </h1>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/wallet/${encoded}/members`}
            aria-label="View members"
            className={
              "group inline-flex min-h-tap items-center gap-2 rounded-full border border-border-soft bg-surface-raised px-3 py-1.5 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-text-strong " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
          >
            {loadingMembers ? (
              <>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="inline-block h-3 w-16 animate-pulse rounded bg-border-soft" />
              </>
            ) : memberAddresses.length > 0 ? (
              <>
                <MemberAvatarStack
                  addresses={memberAddresses}
                  size="sm"
                  max={4}
                />
                <span className="font-numerals tabular-nums">
                  {memberCount}
                </span>
                <span>{memberCount === 1 ? "member" : "members"}</span>
              </>
            ) : (
              <>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                <span>1 member</span>
              </>
            )}
            <ArrowRight
              className="h-3 w-3 text-text-soft/60 transition-transform duration-base group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </Link>
          {pendingApprovalCount > 0 && (
            <a
              href="#action-needed"
              className={
                "inline-flex min-h-tap items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-3 py-1.5 text-[11px] font-semibold text-accent " +
                "transition-[background-color,transform,border-color] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent/15 hover:border-accent/60 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
            >
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <Bell className="h-3 w-3" strokeWidth={2.5} />
              <span className="font-numerals tabular-nums">
                {pendingApprovalCount}
              </span>
              <span>waiting on you</span>
            </a>
          )}
        </div>
      </header>

      {/* ── Balance + actions card ──────────────────────────────
          Wallet value as the focal headline; the three primary
          actions (Send / Receive / Protect) sit underneath as
          first-class affordances. A soft accent bloom in the
          top-right lifts the card off the canvas without
          competing with the number. */}
      <div className={profile.cardClass}>
        <BalanceCardPattern />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 -z-0"
        >
          <div
            className={profile.glowClass}
            style={{
              background: profile.glow,
              filter: "blur(60px)",
            }}
          />
        </div>
        <div className="relative z-10 flex flex-col gap-2.5 p-3 sm:gap-4 sm:p-4 lg:gap-5">
          <div className={profile.portfolioWrapClass}>
            <div className="flex min-w-0 items-start justify-between gap-3">
              <PortfolioPanel
                walletName={name}
                fallbackBalance={balance}
                fallbackBalanceLamports={balanceLamports}
                loadingFallback={loadingBalance}
                label={profile.balanceLabel}
                balancesHidden={balancesHidden}
              />
              <button
                type="button"
                onClick={toggleBalancesHidden}
                aria-label={balancesHidden ? "Show balances" : "Hide balances"}
                title={balancesHidden ? "Show balances" : "Hide balances"}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border-soft bg-canvas/60 text-text-soft transition-colors hover:border-accent/50 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              >
                {balancesHidden ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {profile.stats.length > 0 ? (
              <ul className="hidden grid-cols-3 gap-1.5 sm:grid sm:gap-2">
                {profile.stats.map((stat) => (
                  <li
                    key={stat.label}
                    className="min-w-0 rounded-soft border border-border-soft bg-canvas/70 px-2 py-1.5 sm:px-3 sm:py-2"
                  >
                    <p className="truncate font-mono text-[8px] uppercase tracking-[0.14em] text-text-soft sm:text-[9px] sm:tracking-[0.18em]">
                      {stat.label}
                    </p>
                    <p className="mt-0.5 text-sm font-semibold text-text-strong sm:mt-1">
                      {stat.value({
                        members: memberCount ?? 1,
                        pending: pendingApprovalCount,
                      })}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div
            className={profile.actionsGridClass}
            role="group"
            aria-label={`${profile.productName} actions`}
          >
            {heroActions.map((action) => (
              <HeroActionTile
                key={action.href}
                href={action.href}
                icon={<action.Icon className="h-5 w-5" strokeWidth={1.75} />}
                label={action.label}
                hint={action.hint}
                tone={profile.actionTone}
              />
            ))}
          </div>

        </div>
      </div>
    </motion.section>
  );
}

type HeroStat = {
  label: string;
  value: (input: { members: number; pending: number }) => string;
};

const SHARED_BALANCE_CARD_CLASS =
  "relative overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest";

const SHARED_BALANCE_GLOW_CLASS =
  "absolute -right-24 -top-24 h-60 w-60 rounded-full opacity-50";

const SHARED_BALANCE_GLOW =
  "radial-gradient(circle at center, rgba(204, 255, 0, 0.08) 0%, rgba(204, 255, 0, 0) 70%)";

function productHeroProfile(
  surface: ProductSurfaceId | null,
  shapeLabel: string | null,
): {
  productName: string;
  eyebrow: string;
  avatarClass: string;
  avatarIcon: LucideIcon;
  cardClass: string;
  glowClass: string;
  glow: string;
  portfolioWrapClass: string;
  actionsGridClass: string;
  actionTone: "personal" | "pro" | "agent" | "default";
  balanceLabel: string;
  stats: HeroStat[];
} {
  if (surface === "personal") {
    return {
      productName: "Personal",
      eyebrow: shapeLabel ? `Personal wallet · ${shapeLabel}` : "Personal wallet",
      avatarClass: "rounded-full",
      cardClass: SHARED_BALANCE_CARD_CLASS,
      glowClass: SHARED_BALANCE_GLOW_CLASS,
      glow: SHARED_BALANCE_GLOW,
      portfolioWrapClass: "grid gap-3 sm:gap-4 lg:grid-cols-[1fr_0.85fr] lg:items-end",
      actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
      avatarIcon: productSurfaceIcon(surface),
      actionTone: "personal",
      balanceLabel: "Shared balance",
      stats: [
        { label: "People", value: ({ members }) => String(members) },
        { label: "Waiting", value: ({ pending }) => String(pending) },
        { label: "Protection", value: () => "On" },
      ],
    };
  }
  if (surface === "pro") {
    return {
      productName: "Pro",
      eyebrow: "Pro treasury",
      avatarClass: "rounded-full",
      avatarIcon: productSurfaceIcon(surface),
      cardClass: SHARED_BALANCE_CARD_CLASS,
      glowClass: SHARED_BALANCE_GLOW_CLASS,
      glow: SHARED_BALANCE_GLOW,
      portfolioWrapClass: "grid gap-3 sm:gap-4 lg:grid-cols-[1.25fr_1fr] lg:items-end",
      actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
      actionTone: "pro",
      balanceLabel: "Treasury value",
      stats: [
        { label: "Approvers", value: ({ members }) => String(members) },
        { label: "Queue", value: ({ pending }) => String(pending) },
        { label: "Protection", value: () => "On" },
      ],
    };
  }
  if (surface === "agent") {
    return {
      productName: "Agent",
      eyebrow: "Agent vault · trading desk",
      avatarClass: "rounded-full",
      cardClass: SHARED_BALANCE_CARD_CLASS,
      glowClass: SHARED_BALANCE_GLOW_CLASS,
      glow: SHARED_BALANCE_GLOW,
      portfolioWrapClass: "grid gap-3 sm:gap-4 lg:grid-cols-[1fr_1.1fr] lg:items-end",
      actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
      avatarIcon: productSurfaceIcon(surface),
      actionTone: "agent",
      balanceLabel: "Trading funds",
      stats: [
        { label: "Trader", value: () => "Ready" },
        { label: "Queue", value: ({ pending }) => String(pending) },
        { label: "Risk", value: () => "Guarded" },
      ],
    };
  }
  if (surface === "p2pdefi") {
    return {
      productName: "P2P",
      eyebrow: "P2P wallet",
      avatarClass: "rounded-full",
      avatarIcon: productSurfaceIcon(surface),
      cardClass: SHARED_BALANCE_CARD_CLASS,
      glowClass: SHARED_BALANCE_GLOW_CLASS,
      glow: SHARED_BALANCE_GLOW,
      portfolioWrapClass: "grid gap-3 sm:gap-4 lg:grid-cols-[1.25fr_1fr] lg:items-end",
      actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
      actionTone: "default",
      balanceLabel: "Settlement balance",
      stats: [],
    };
  }
  if (surface === "payments") {
    return {
      productName: "Payments",
      eyebrow: "Payments wallet",
      avatarClass: "rounded-full",
      avatarIcon: productSurfaceIcon(surface),
      cardClass: SHARED_BALANCE_CARD_CLASS,
      glowClass: SHARED_BALANCE_GLOW_CLASS,
      glow: SHARED_BALANCE_GLOW,
      portfolioWrapClass: "grid gap-3 sm:gap-4 lg:grid-cols-[1.25fr_1fr] lg:items-end",
      actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
      actionTone: "default",
      balanceLabel: "Payment balance",
      stats: [],
    };
  }
  return {
    productName: "Wallet",
    eyebrow: shapeLabel ? `Shared wallet · ${shapeLabel}` : "Shared wallet · Solana devnet",
    avatarClass: "rounded-full",
    cardClass: SHARED_BALANCE_CARD_CLASS,
    glowClass: SHARED_BALANCE_GLOW_CLASS,
    glow: SHARED_BALANCE_GLOW,
    portfolioWrapClass: "flex flex-col",
    actionsGridClass: "grid grid-cols-3 gap-2 sm:gap-3",
    avatarIcon: productSurfaceIcon(surface),
    actionTone: "default",
    balanceLabel: "Balance",
    stats: [],
  };
}

function productHeroActions(
  surface: ProductSurfaceId | null,
  encoded: string,
): Array<{ href: string; Icon: LucideIcon; label: string; hint?: string }> {
  if (surface === "personal") {
    return [
      { href: `/app/wallet/${encoded}/send`, Icon: Send, label: "Send", hint: "Pay" },
      { href: `/app/wallet/${encoded}/receive`, Icon: Download, label: "Receive", hint: "Deposit" },
      { href: `/app/wallet/${encoded}/policy`, Icon: ShieldCheck, label: "Protect", hint: "Safety" },
    ];
  }
  if (surface === "pro") {
    return [
      { href: `/app/wallet/${encoded}/send`, Icon: Send, label: "Send", hint: "Pay" },
      { href: `/app/wallet/${encoded}/receive`, Icon: Download, label: "Receive", hint: "Deposit" },
      { href: `/app/wallet/${encoded}/policy`, Icon: ShieldCheck, label: "Protect", hint: "Safety" },
    ];
  }
  if (surface === "agent") {
    return [
      { href: `/app/wallet/${encoded}/agents`, Icon: Bot, label: "Desk", hint: "Trade" },
      { href: `/app/wallet/${encoded}/receive`, Icon: Download, label: "Receive", hint: "Deposit" },
      { href: `/app/wallet/${encoded}/agents/policy`, Icon: ShieldCheck, label: "Protect", hint: "Safety" },
    ];
  }
  return [
    { href: `/app/wallet/${encoded}/send`, Icon: Send, label: "Send", hint: "Pay anyone" },
    { href: `/app/wallet/${encoded}/receive`, Icon: Download, label: "Receive", hint: "Get paid" },
    { href: `/app/wallet/${encoded}/policy`, Icon: ShieldCheck, label: "Protect", hint: "Safety" },
  ];
}

// Hero primary-action tile. ≥80px tap target, accent icon disc,
// label + optional small hint. Matches the kit's section card
// vocabulary (rounded-card / border-border-soft / bg-canvas).
// Hover swaps the border to accent and lifts; no neon glow.
function HeroActionTile({
  href,
  icon,
  label,
  hint,
  tone = "default",
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  hint?: string;
  tone?: "personal" | "pro" | "agent" | "default";
}) {
  const toneClass =
    tone === "pro"
      ? "border-border-strong bg-surface-raised hover:border-accent/50"
      : tone === "agent"
        ? "border-accent/20 bg-white/[0.03] text-white hover:border-accent/60 hover:bg-accent/[0.06]"
        : tone === "personal"
          ? "border-border-soft bg-canvas hover:border-emerald-400/40"
          : "border-border-soft bg-canvas hover:border-accent/40";
  const iconClass =
    tone === "agent"
      ? "bg-accent/15 text-accent"
      : tone === "personal"
        ? "bg-emerald-500/10 text-emerald-400"
        : "bg-accent/10 text-accent";
  return (
    <Link
      href={href}
      className={
        "group flex min-h-[60px] flex-col items-center justify-center gap-0.5 rounded-card border px-2 py-2 sm:min-h-[88px] sm:gap-1.5 sm:px-3 sm:py-3.5 " +
        "text-xs font-medium text-text-strong shadow-card-rest " +
        "transition-[transform,border-color,box-shadow,background-color] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
        toneClass
      }
    >
      <span className={"flex h-7 w-7 items-center justify-center rounded-full transition-colors duration-base ease-out-soft group-hover:bg-accent/15 sm:h-9 sm:w-9 " + iconClass}>
        {icon}
      </span>
      <span className="text-center text-xs font-semibold leading-tight text-text-strong sm:text-[13px]">
        {label}
      </span>
      {hint && (
        <span className="hidden text-[10px] font-medium uppercase tracking-[0.16em] text-text-soft sm:inline">
          {hint}
        </span>
      )}
    </Link>
  );
}

// ─── Portfolio total ───────────────────────────────────────────────
//
// Sums every bound chain's balance × demo USD price. SOL is always
// present; ETH/BTC/Zcash join when bound. The hero deliberately shows
// only one number; per-chain balances live in the Assets section.
function PortfolioPanel({
  walletName,
  fallbackBalance,
  fallbackBalanceLamports,
  loadingFallback,
  label = "Balance",
  balancesHidden = false,
}: {
  walletName: string;
  fallbackBalance: { amount: string; ticker: string } | null;
  fallbackBalanceLamports: number | null;
  loadingFallback: boolean;
  label?: string;
  balancesHidden?: boolean;
}) {
  const portfolio = useWalletPortfolio(walletName);
  const fiat = useDisplayCurrency();
  const hiddenClass = balancesHidden ? "blur-sm select-none" : "";

  // Multi-chain check - only when a non-Solana chain has loaded.
  const hasMultipleChains =
    portfolio.breakdown.filter((c) => c.raw !== null && c.raw > 0n).length >
    1 || portfolio.breakdown.length > 1;

  if (!hasMultipleChains) {
    // Single-chain fallback: kit-styled eyebrow + numerals + ticker.
    // Bumped the value to display-sm so the headline number leads
    // the hero - this is the centerpiece, not a stat.
    return (
      <div className="flex flex-col items-start gap-1.5 sm:gap-2">
        <div className="flex items-center gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            {label}
          </p>
          <InfoTip
            label="About balance prices"
            title="Balance prices"
            width="sm"
            size="xs"
          >
            Prices are demo values for now. Treat them as a guide, not a quote.
          </InfoTip>
        </div>
        {loadingFallback ? (
          <div className="h-9 w-44 animate-pulse rounded bg-border-soft sm:h-11 sm:w-56" />
        ) : (
          <>
            <p className={`flex items-baseline gap-2 transition-[filter] duration-base ${hiddenClass}`}>
              <span className="font-numerals text-2xl font-semibold leading-none text-text-strong tabular-nums sm:text-display-sm">
                {fallbackBalance ? fallbackBalance.amount : "0"}
              </span>
              <span className="font-display text-sm font-semibold uppercase tracking-[0.18em] text-text-soft">
                {fallbackBalance?.ticker ?? "SOL"}
              </span>
            </p>
            {fallbackBalanceLamports !== null && fallbackBalanceLamports > 0 && (
              <span className={`transition-[filter] duration-base ${hiddenClass}`}>
                <UsdHint
                  amount={BigInt(Math.round(fallbackBalanceLamports))}
                  smallestPerWhole={1_000_000_000n}
                  ticker={fallbackBalance?.ticker ?? "SOL"}
                  variant="plain"
                  className="font-numerals text-xs tabular-nums text-text-soft"
                />
              </span>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:gap-2">
      <div className="flex items-center gap-1">
        <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          {label}
        </p>
        <InfoTip
          label="About balance prices"
          title="Balance prices"
          width="sm"
          size="xs"
        >
          Prices are demo values for now. Treat them as a guide, not a quote.
          {portfolio.unknownPriceChains.length > 0
            ? ` No quote is available for ${portfolio.unknownPriceChains.join(", ")} yet.`
            : ""}
        </InfoTip>
      </div>
      {portfolio.isLoading && portfolio.totalUsd === 0 ? (
        <div className="h-9 w-44 animate-pulse rounded bg-border-soft sm:h-11 sm:w-56" />
      ) : (
        <>
          <p className={`font-numerals text-2xl font-semibold leading-none text-text-strong tabular-nums transition-[filter] duration-base sm:text-display-sm ${hiddenClass}`}>
            {fiat.format(portfolio.totalUsd)}
          </p>
        </>
      )}
    </div>
  );
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
                    {row.amountDisplay ?? "-"} {row.ticker ?? ""}
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
                    className="shrink-0 rounded-pill border border-border-soft bg-canvas px-3 py-1 text-[11px] font-medium text-text-strong transition hover:text-accent"
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
// Fetches actual chain-native activity for the wallet's address -
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
  const encoded = encodeURIComponent(walletName);
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
            `/app/wallet/${encoded}/send/erc20` +
            `?token=${encodeURIComponent(h.contractAddress)}`;
          const receiveHref = `/app/wallet/${encoded}/receive?chain=evm_1559`;
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
                  <UsdHint
                    amount={h.rawBalance}
                    smallestPerWhole={10n ** BigInt(h.decimals)}
                    ticker={h.symbol}
                  />
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Link
                  href={receiveHref}
                  aria-label={`Receive ${h.symbol}`}
                  title={`Receive ${h.symbol}`}
                  className={
                    "inline-flex min-h-9 items-center justify-center rounded-full border border-border-soft bg-canvas px-2.5 text-[11px] font-medium text-text-strong " +
                    "transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  Receive
                </Link>
                <Link
                  href={sendHref}
                  aria-label={`Send ${h.symbol}`}
                  title={`Send ${h.symbol}`}
                  className={
                    "inline-flex min-h-9 items-center justify-center rounded-full border border-border-soft bg-canvas px-2.5 text-[11px] font-medium text-text-strong " +
                    "transition-[border-color,color,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:border-accent/40 hover:text-accent " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  Send
                </Link>
              </div>
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
          On-chain transactions ({chainTicker})
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
                  className="shrink-0 rounded-pill border border-border-soft bg-canvas px-3 py-1 text-[11px] font-medium text-text-strong transition hover:text-accent"
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

// ─── Manage tab actions ────────────────────────────────────────────
//
// The Manage tab owns low-frequency actions, but it must not become a
// product switcher. Rows are generated from the wallet's selected
// surface so Personal, Pro, and Agent vaults keep separate affordances.

function ProOperationsPanel({
  name,
  actionRows,
  activityRows,
  attempts,
  reduce,
}: {
  name: string;
  actionRows: ActionNeededRow[];
  activityRows: RecentActivityRow[];
  attempts: TxAttempt[];
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(name);
  const runtime = useMemo(() => getProTreasuryRuntime(), []);
  const schedules = useProSchedules(name);
  const budgetUsage = useWalletBudgetUsage(name);
  const [alertsReady, setAlertsReady] = useState(false);
  const [scheduleDraft, setScheduleDraft] = useState({
    name: "",
    address: "",
    category: "vendor" as ProSchedule["category"],
    amount: "",
    asset: runtime.defaultPaymentAsset,
    cadence: "Monthly" as ProSchedule["cadence"],
    nextRun: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
    note: "",
  });
  const lastReceipt = attempts[0] ?? null;
  const dueSchedules = schedules.rows.filter(isScheduleDue);
  const limitsReady = hasAnyProLimit(budgetUsage);

  useEffect(() => {
    setAlertsReady(loadEmailPrefs().enabled || loadWebhookPrefs().enabled);
  }, []);

  const saveSchedule = () => {
    const payee = scheduleDraft.name.trim();
    const amount = scheduleDraft.amount.trim();
    if (!payee || !amount) return;
    schedules.add({
      ...scheduleDraft,
      name: payee,
      address: scheduleDraft.address.trim(),
      amount,
      asset: scheduleDraft.asset.trim().toUpperCase() || "USDC",
      note: scheduleDraft.note.trim(),
    });
    setScheduleDraft((current) => ({
      ...current,
      name: "",
      address: "",
      amount: "",
      note: "",
    }));
  };

  const exportAudit = () => {
    const csv = buildActivityCsv({
      walletName: name,
      rows: activityRows,
      attempts,
    });
    const slug = name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadActivityCsv(`clearsig-pro-${slug || "treasury"}-${stamp}.csv`, csv);
  };

  const exportAccounting = () => {
    const csv = buildProAccountingCsv({
      walletName: name,
      attempts,
      schedules: schedules.rows,
    });
    const slug = name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadProAccountingCsv(
      `clearsig-accounting-${slug || "treasury"}-${stamp}.csv`,
      csv,
    );
  };

  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-4"
      aria-label="Pro treasury operations"
    >
      <div className="rounded-card border border-accent/25 bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
              Pro command center · {runtime.environmentLabel}
            </p>
            <h2 className="mt-1 font-display text-xl leading-tight text-text-strong">
              Pay, protect, and prove.
            </h2>
          </div>
          <Link
            href={
              actionRows.length > 0
                ? "#action-needed"
                : `/app/wallet/${encoded}/send/batch`
            }
            className={
              "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-text-on-accent shadow-accent-rest " +
              "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            {actionRows.length > 0 ? "Approval queue" : "Batch payments"}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <ProMetricTile label="Approval inbox" value={String(actionRows.length)} />
          <ProMetricTile label="Due payments" value={String(dueSchedules.length)} />
          <ProMetricTile label="Receipts" value={String(attempts.length)} />
        </div>
      </div>

      <ProReadinessStrip
        walletName={name}
        actionCount={actionRows.length}
        dueCount={dueSchedules.length}
        hasSchedules={schedules.rows.length > 0}
        limitsReady={limitsReady}
        alertsReady={alertsReady}
        auditReady={activityRows.length + attempts.length > 0}
      />

      <div className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
        <ActionGroup label="Payments">
          <ActionRow
            href={`/app/wallet/${encoded}/send`}
            icon={Send}
            title="Send payment"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/send/batch`}
            icon={Users}
            title="Batch payments"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/send/batch?template=payroll`}
            icon={Banknote}
            title="Payroll"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/send?kind=vendor`}
            icon={Coins}
            title="Vendor payment"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/escrow`}
            icon={FileCheck2}
            title="Project escrow"
          />
        </ActionGroup>

        <ProScheduleCard
          draft={scheduleDraft}
          rows={schedules.rows}
          walletName={name}
          defaultAsset={runtime.defaultPaymentAsset}
          onDraftChange={setScheduleDraft}
          onSave={saveSchedule}
          onRemove={schedules.remove}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ActionGroup label="Protection">
          <ActionRow
            href={`/app/wallet/${encoded}/policy`}
            icon={ShieldCheck}
            title="Approval rules"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/members`}
            icon={Users}
            title="Team and roles"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/budget`}
            icon={Banknote}
            title="Spending limits"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/policy#risk`}
            icon={Activity}
            title="Risk checks"
          />
        </ActionGroup>

        <ActionGroup label="Automation">
          <ActionRow
            href={`/app/wallet/${encoded}/agents`}
            icon={Bot}
            title="Agent vaults"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/agents/funding`}
            icon={TrendingDown}
            title="Trading budget"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/swap`}
            icon={Repeat2}
            title="Swap crypto"
          />
          <ActionRow
            href={`/app/wallet/${encoded}/receive`}
            icon={Download}
            title="Receive funds"
          />
        </ActionGroup>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <ProAuditCard
          activityCount={activityRows.length}
          lastReceipt={lastReceipt}
          onExport={exportAudit}
          onExportAccounting={exportAccounting}
          activityHref={`/app/wallet/${encoded}/activity`}
          csvColumns={runtime.batchCsvColumns}
          accountingTargets={runtime.accountingTargets}
        />
        <ActionGroup label="Admin">
          <ActionRow
            href={`/app/wallet/${encoded}/chains/add?autostart=1`}
            icon={Network}
            title="Add asset"
          />
          <ActionRow
            href="/app/settings#notifications"
            icon={SettingsIcon}
            title="Webhooks"
          />
          <ActionRow
            href={`/app/wallet/new?surface=pro&import=1`}
            icon={Download}
            title={`Import ${runtime.importSources.join(" / ")}`}
          />
          <ActionRow
            href="/app/settings#advanced"
            icon={Network}
            title={`Accounting: ${runtime.accountingTargets.join(" / ")}`}
          />
          <ActionRow
            href={runtime.securityUrl}
            icon={ShieldCheck}
            title="Security posture"
          />
          <ActionRow
            href={runtime.auditUrl}
            icon={Activity}
            title="Audit evidence"
          />
          <ActionRow
            href={runtime.statusUrl}
            icon={Bell}
            title="Status"
          />
          <ActionRow
            href={runtime.recoveryUrl}
            icon={ShieldCheck}
            title="Recovery policy"
          />
        </ActionGroup>
      </div>
    </motion.section>
  );
}

function ProMetricTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas/70 px-3 py-2.5">
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 font-numerals text-lg font-semibold tabular-nums text-text-strong">
        {value}
      </p>
    </div>
  );
}

function hasAnyProLimit(usage: ReturnType<typeof useWalletBudgetUsage>): boolean {
  const weeklyCap = usage.budget?.weeklyUsd;
  const velocity = usage.budget?.velocityPerDay;
  return (
    (weeklyCap !== null && weeklyCap !== undefined) ||
    !!velocity ||
    usage.perChain.some((row) => row.cap !== null)
  );
}

function ProReadinessStrip({
  walletName,
  actionCount,
  dueCount,
  hasSchedules,
  limitsReady,
  alertsReady,
  auditReady,
}: {
  walletName: string;
  actionCount: number;
  dueCount: number;
  hasSchedules: boolean;
  limitsReady: boolean;
  alertsReady: boolean;
  auditReady: boolean;
}) {
  const encoded = encodeURIComponent(walletName);
  const items = [
    {
      label: "Approvals",
      value: actionCount > 0 ? `${actionCount} waiting` : "Ready",
      href: actionCount > 0 ? "#action-needed" : undefined,
      active: actionCount === 0,
    },
    {
      label: "Limits",
      value: limitsReady ? "Set" : "Add",
      href: `/app/wallet/${encoded}/budget`,
      active: limitsReady,
    },
    {
      label: "Recurring",
      value: hasSchedules ? (dueCount > 0 ? `${dueCount} due` : "Ready") : "Add",
      href: hasSchedules ? undefined : "#pro-recurring",
      active: hasSchedules && dueCount === 0,
    },
    {
      label: "Alerts",
      value: alertsReady ? "On" : "Add",
      href: "/app/settings#notifications",
      active: alertsReady,
    },
    {
      label: "Audit",
      value: auditReady ? "Ready" : "Waiting",
      href: `/app/wallet/${encoded}/activity`,
      active: auditReady,
    },
  ];

  return (
    <section
      aria-label="Pro readiness"
      className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest"
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {items.map((item) => {
          const body = (
            <>
              <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-text-soft">
                {item.label}
              </span>
              <span
                className={
                  "mt-1 text-sm font-semibold " +
                  (item.active ? "text-text-strong" : "text-accent")
                }
              >
                {item.value}
              </span>
            </>
          );

          if (item.href) {
            return (
              <Link
                key={item.label}
                href={item.href}
                className="flex min-h-14 flex-col justify-center rounded-soft border border-border-soft bg-canvas/70 px-3 py-2 transition hover:border-accent/40"
              >
                {body}
              </Link>
            );
          }

          return (
            <div
              key={item.label}
              className="flex min-h-14 flex-col justify-center rounded-soft border border-border-soft bg-canvas/70 px-3 py-2"
            >
              {body}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type ProScheduleDraft = Omit<ProSchedule, "id" | "createdAt"> & {
  address: string;
  note: string;
};

function ProScheduleCard({
  draft,
  rows,
  walletName,
  defaultAsset,
  onDraftChange,
  onSave,
  onRemove,
}: {
  draft: ProScheduleDraft;
  rows: ProSchedule[];
  walletName: string;
  defaultAsset: string;
  onDraftChange: (next: ProScheduleDraft) => void;
  onSave: () => void;
  onRemove: (id: string) => void;
}) {
  const encoded = encodeURIComponent(walletName);
  const contacts = useContacts();
  const datalistId = `pro-payees-${encoded}`;
  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const aDue = isScheduleDue(a) ? 0 : 1;
        const bDue = isScheduleDue(b) ? 0 : 1;
        if (aDue !== bDue) return aDue - bDue;
        return a.nextRun.localeCompare(b.nextRun);
      }),
    [rows],
  );
  return (
    <section
      id="pro-recurring"
      className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-text-soft">
          Recurring
        </h3>
        <span className="font-numerals text-xs tabular-nums text-text-soft">
          {rows.length}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        <input
          value={draft.name}
          onChange={(event) =>
            onDraftChange({ ...draft, name: event.target.value })
          }
          placeholder="Vendor or team member"
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none placeholder:text-text-soft focus:border-accent/50"
        />
        <input
          value={draft.address ?? ""}
          onChange={(event) =>
            onDraftChange({ ...draft, address: event.target.value })
          }
          list={datalistId}
          placeholder="Wallet address or saved contact"
          spellCheck={false}
          autoComplete="off"
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none placeholder:text-text-soft focus:border-accent/50"
        />
        <datalist id={datalistId}>
          {contacts.contacts.map((contact) => (
            <option key={contact.address} value={contact.address}>
              {contact.name}
            </option>
          ))}
        </datalist>
        <div className="grid grid-cols-[1fr_88px] gap-2">
          <input
            value={draft.amount}
            onChange={(event) =>
              onDraftChange({ ...draft, amount: event.target.value })
            }
            placeholder="Amount"
            inputMode="decimal"
            className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none placeholder:text-text-soft focus:border-accent/50"
          />
          <input
            value={draft.asset}
            onChange={(event) =>
              onDraftChange({ ...draft, asset: event.target.value })
            }
            aria-label="Asset"
            placeholder={defaultAsset}
            className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm font-semibold uppercase text-text-strong outline-none focus:border-accent/50"
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <select
            value={draft.category}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                category: event.target.value as ProSchedule["category"],
              })
            }
            className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none focus:border-accent/50"
          >
            <option value="vendor">Vendor</option>
            <option value="payroll">Payroll</option>
          </select>
          <select
            value={draft.cadence}
            onChange={(event) =>
              onDraftChange({
                ...draft,
                cadence: event.target.value as ProSchedule["cadence"],
              })
            }
            className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none focus:border-accent/50"
          >
            <option value="Weekly">Weekly</option>
            <option value="Monthly">Monthly</option>
          </select>
        </div>
        <input
          type="date"
          value={draft.nextRun}
          onChange={(event) =>
            onDraftChange({ ...draft, nextRun: event.target.value })
          }
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none focus:border-accent/50"
        />
        <input
          value={draft.note ?? ""}
          onChange={(event) =>
            onDraftChange({ ...draft, note: event.target.value })
          }
          placeholder="Note (optional)"
          maxLength={80}
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none placeholder:text-text-soft focus:border-accent/50"
        />
        <button
          type="button"
          onClick={onSave}
          disabled={!draft.name.trim() || !draft.amount.trim()}
          className={
            "min-h-11 rounded-soft bg-accent px-4 text-sm font-semibold text-text-on-accent shadow-accent-rest " +
            "transition-[background-color,transform,opacity] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
          }
        >
          Save schedule
        </button>
      </div>
      {rows.length > 0 ? (
        <ul className="mt-3 divide-y divide-border-soft">
          {sortedRows.slice(0, 4).map((row) => {
            const due = isScheduleDue(row);
            const payHref = schedulePaymentHref(row, encoded);
            return (
            <li key={row.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text-strong">
                  {row.name}
                  {due ? (
                    <span className="ml-2 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">
                      Due
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-text-soft">
                  {row.amount} {row.asset} · {row.cadence} · {row.nextRun}
                  {row.address ? ` · ${formatScheduleAddress(row.address)}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Link
                  href={payHref}
                  className="rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-semibold text-text-strong transition hover:border-accent/40 hover:text-accent"
                >
                  Pay
                </Link>
                <button
                  type="button"
                  onClick={() => onRemove(row.id)}
                  className="rounded-full border border-border-soft px-2.5 py-1 text-[11px] text-text-soft transition hover:text-text-strong"
                >
                  Done
                </button>
              </div>
            </li>
          );
          })}
        </ul>
      ) : null}
    </section>
  );
}

function isScheduleDue(row: ProSchedule): boolean {
  if (!row.nextRun) return false;
  const dueAt = new Date(`${row.nextRun}T00:00:00`);
  return Number.isFinite(dueAt.getTime()) && dueAt.getTime() <= Date.now();
}

function schedulePaymentHref(row: ProSchedule, encodedWalletName: string): string {
  if (row.category === "payroll") {
    return `/app/wallet/${encodedWalletName}/send/batch?template=payroll`;
  }
  const asset = row.asset.trim().toUpperCase();
  const params = new URLSearchParams({ kind: "vendor" });
  if (asset === "SOL") {
    params.set("recipient", row.address?.trim() || row.name);
    params.set("amount", row.amount);
    params.set("note", row.note?.trim() || `${row.cadence} vendor payment`);
  }
  return `/app/wallet/${encodedWalletName}/send?${params.toString()}`;
}

function formatScheduleAddress(address: string): string {
  const trimmed = address.trim();
  if (!trimmed) return "";
  return isValidSolanaAddress(trimmed) ? shortAddress(trimmed) : trimmed;
}

function ProAuditCard({
  activityCount,
  lastReceipt,
  onExport,
  onExportAccounting,
  activityHref,
  csvColumns,
  accountingTargets,
}: {
  activityCount: number;
  lastReceipt: TxAttempt | null;
  onExport: () => void;
  onExportAccounting: () => void;
  activityHref: string;
  csvColumns: string[];
  accountingTargets: string[];
}) {
  const receiptCopy = lastReceipt
    ? humanReceipt(lastReceipt)
    : "Receipts appear after sends and approvals.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-text-soft">
          Audit
        </h3>
        <span className="font-numerals text-xs tabular-nums text-text-soft">
          {activityCount}
        </span>
      </div>
      <div className="mt-3 rounded-soft border border-border-soft bg-canvas/70 p-3">
        <p className="text-sm font-medium text-text-strong">Latest receipt</p>
        <p className="mt-1 text-xs leading-relaxed text-text-soft">
          {receiptCopy}
        </p>
        <p className="mt-2 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft/70">
          CSV · {csvColumns.join(", ")}
        </p>
        <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft/70">
          Finance · {accountingTargets.join(" / ")}
        </p>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        <button
          type="button"
          onClick={onExport}
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm font-semibold text-text-strong transition hover:border-accent/40 hover:text-accent"
        >
          Export CSV
        </button>
        <button
          type="button"
          onClick={onExportAccounting}
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm font-semibold text-text-strong transition hover:border-accent/40 hover:text-accent"
        >
          Accounting
        </button>
        <Link
          href={activityHref}
          className="inline-flex min-h-11 items-center justify-center rounded-soft border border-border-soft bg-canvas px-3 text-sm font-semibold text-text-strong transition hover:border-accent/40 hover:text-accent"
        >
          Audit view
        </Link>
      </div>
    </section>
  );
}

function humanReceipt(row: TxAttempt): string {
  const action = row.status === "success" ? "Sent" : "Tried to send";
  const amount = [row.amountDisplay, row.ticker].filter(Boolean).join(" ");
  const target = row.recipientShort ? ` to ${row.recipientShort}` : "";
  if (row.status === "failed") {
    return `${action} ${amount || "money"}${target}. It did not leave the treasury.`;
  }
  return `${action} ${amount || "money"}${target}. Receipt saved.`;
}

function Actions({
  name,
  productSurface,
  hasIntents,
  reduce,
}: {
  name: string;
  productSurface: ProductSurfaceId | null;
  /// null while loading, false once we've confirmed no intents exist.
  hasIntents: boolean | null;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(name);
  const sendingReady = hasIntents !== false;
  const groups = manageActionGroups(productSurface, encoded);
  const isPersonal = productSurface === "personal";
  const showSetupPrompt =
    !sendingReady &&
    (isPersonal ||
      productSurface === "pro" ||
      productSurface === null);

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-col gap-5"
    >
      {showSetupPrompt && (
        <Link
          href={`/app/wallet/${encoded}/setup`}
          className={
            "group flex items-center gap-3 rounded-card border border-accent/30 bg-accent/[0.05] p-5 shadow-card-rest " +
            "transition-[transform,border-color,box-shadow] duration-base ease-out-soft " +
            "hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-card-raised " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Send className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-text-strong">
              Turn on sending
            </p>
            <p className="mt-0.5 text-xs text-text-soft">
              Turn it on once. Every send after that uses a readable receipt.
            </p>
          </div>
          <ArrowRight
            className="h-4 w-4 shrink-0 text-accent transition-transform duration-base group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </Link>
      )}

      {isPersonal ? <PersonalSafetyPanel walletName={name} /> : null}

      {groups.map((group) => (
        <ActionGroup
          key={group.label}
          label={group.label}
          description={group.description}
        >
          {group.rows.map((row) => (
            <ActionRow
              key={row.href}
              href={row.href}
              icon={row.icon}
              title={row.title}
              body={row.body}
            />
          ))}
        </ActionGroup>
      ))}
    </motion.div>
  );
}

type ManageActionGroup = {
  label: string;
  description?: string;
  rows: Array<{
    href: string;
    icon: LucideIcon;
    title: string;
    body?: string;
  }>;
};

function PersonalSafetyPanel({ walletName }: { walletName: string }) {
  const encoded = encodeURIComponent(walletName);
  const contacts = useContacts();
  const [pause, setPause] = useState(() => getEmergencyPause(walletName));
  const [categories, setCategories] = useState<SpendingCategory[]>(() =>
    getSpendingCategories(walletName),
  );
  const [receipts, setReceipts] = useState<PersonalReceipt[]>(() =>
    listPersonalReceipts(walletName),
  );

  useEffect(() => {
    const refresh = () => {
      setPause(getEmergencyPause(walletName));
      setCategories(getSpendingCategories(walletName));
      setReceipts(listPersonalReceipts(walletName));
    };
    refresh();
    window.addEventListener("clear:personal-receipts-changed", refresh);
    window.addEventListener("clear:emergency-pause-changed", refresh);
    window.addEventListener("clear:spending-categories-changed", refresh);
    return () => {
      window.removeEventListener("clear:personal-receipts-changed", refresh);
      window.removeEventListener("clear:emergency-pause-changed", refresh);
      window.removeEventListener("clear:spending-categories-changed", refresh);
    };
  }, [walletName]);

  const togglePause = () => {
    const next = saveEmergencyPause(walletName, !pause.paused);
    setPause(next);
    const paused = next.paused;
    recordPersonalReceipt(walletName, {
      title: paused ? "You paused sends." : "You resumed sends.",
      body: paused
        ? "New sends are blocked until you resume from Protection."
        : "This wallet can send again under its approval rules.",
    });
  };

  const toggleCategory = (id: SpendingCategory["id"]) => {
    const changed = categories.find((category) => category.id === id);
    const next = categories.map((category) =>
      category.id === id
        ? { ...category, enabled: !category.enabled }
        : category,
    );
    setCategories(next);
    saveSpendingCategories(walletName, next);
    const updated = next.find((category) => category.id === id);
    if (changed && updated) {
      recordPersonalReceipt(walletName, {
        title: `${updated.label} ${updated.enabled ? "added" : "hidden"}.`,
        body: updated.enabled
          ? `${updated.label} is now visible as a spending category.`
          : `${updated.label} is hidden from the category shortcuts.`,
      });
    }
  };
  const latestReceipt = receipts[0] ?? null;

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Protection
          </p>
          <h2 className="mt-1 font-display text-lg leading-tight text-text-strong">
            A shared wallet normal people can trust.
          </h2>
        </div>
        <button
          type="button"
          onClick={togglePause}
          className={
            "inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition " +
            (pause.paused
              ? "border border-warning/40 bg-warning/10 text-warning"
              : "border border-border-soft bg-canvas text-text-strong hover:border-accent/40 hover:text-accent")
          }
        >
          <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
          {pause.paused ? "Resume" : "Pause"}
        </button>
      </div>

      {pause.paused ? (
        <div className="mt-3 rounded-soft border border-warning/30 bg-warning/[0.07] px-3 py-2 text-xs leading-relaxed text-text-soft">
          Sends are paused. Receiving money and reviewing history still work.
        </div>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/members`}
          icon={Users}
          title="People"
          value={`${contacts.contacts.length} saved`}
        />
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/policy`}
          icon={ShieldCheck}
          title="Approvals"
          value="Readable"
        />
        <PersonalSafetyLink
          href="/app/secure"
          icon={Heart}
          title="Recovery"
          value="Calm"
        />
        <PersonalSafetyLink
          href="/app/settings#notifications"
          icon={Bell}
          title="Notifications"
          value="Mobile-first"
        />
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/buy`}
          icon={Banknote}
          title="Buy"
          value="Bank"
        />
        <PersonalSafetyLink
          href={`/app/wallet/${encoded}/sell`}
          icon={TrendingDown}
          title="Withdraw"
          value="Bank"
        />
      </div>

      <div className="mt-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-soft">
          Categories
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {categories.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => toggleCategory(category.id)}
              className={
                "rounded-full border px-3 py-1.5 text-xs font-medium transition " +
                (category.enabled
                  ? "border-accent/30 bg-accent/10 text-accent"
                  : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
              }
            >
              {category.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-2.5">
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <ReceiptText className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-strong">
              {latestReceipt?.title ?? "Receipts will appear here."}
            </p>
            <p className="mt-0.5 text-xs leading-snug text-text-soft">
              {latestReceipt?.body ??
                "Every protection change gets a readable receipt."}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function PersonalSafetyLink({
  href,
  icon: Icon,
  title,
  value,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  value: string;
}) {
  return (
    <Link
      href={href}
      className="group flex min-h-16 items-center gap-3 rounded-soft border border-border-soft bg-canvas px-3 py-2 transition hover:border-accent/40"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-text-strong">
          {title}
        </span>
        <span className="block truncate text-xs text-text-soft">{value}</span>
      </span>
      <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-text-soft transition group-hover:translate-x-0.5 group-hover:text-accent" />
    </Link>
  );
}

function manageActionGroups(
  surface: ProductSurfaceId | null,
  encoded: string,
): ManageActionGroup[] {
  if (surface === "personal") {
    return [
      {
        label: "Money",
        rows: personalMoneyActionRows(encoded),
      },
      {
        label: "More",
        rows: [
          {
            href: `/app/wallet/${encoded}/chains/add?autostart=1`,
            icon: Network,
            title: "Add asset",
          },
        ],
      },
    ];
  }

  if (surface === "pro") {
    return [];
  }

  if (surface === "agent") {
    return [
      {
        label: "Networks",
        description: "Add a chain before funding or trading there.",
        rows: networkActionRows(encoded),
      },
      {
        label: "More budget",
        description: "Fine-tune capital assigned to trader activity.",
        rows: [
          {
            href: `/app/wallet/${encoded}/agents/funding`,
            icon: Banknote,
            title: "Trading budget",
            body: "Bounded capital for trader activity.",
          },
          {
            href: `/app/wallet/${encoded}/swap`,
            icon: Repeat2,
            title: "Swap crypto",
            body: "Manual review before agent automation.",
          },
        ],
      },
    ];
  }

  return [
    {
      label: "Protection",
      description: "Fine-tune people, approvals, and send safety.",
      rows: rulesActionRows(encoded, null),
    },
    {
      label: "Networks",
      description: "Add another chain to this wallet.",
      rows: networkActionRows(encoded),
    },
    {
      label: "More money",
      rows: moneyActionRows(encoded),
    },
  ];
}

function rulesActionRows(
  encoded: string,
  surface: ProductSurfaceId | null,
): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/policy`,
      icon: ShieldCheck,
      title: "Protection",
      body:
        surface === "pro"
          ? "Approvals, people, limits, and alerts."
          : "Approvals, people, and alerts.",
    },
  ];
}

function networkActionRows(encoded: string): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/chains/add?autostart=1`,
      icon: Network,
      title: "Add chain",
      body: "Add an asset once.",
    },
  ];
}

function moneyActionRows(encoded: string): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/swap`,
      icon: Repeat2,
      title: "Swap crypto",
    },
    {
      href: `/app/wallet/${encoded}/buy`,
      icon: Banknote,
      title: "Buy crypto with your bank account",
    },
    {
      href: `/app/wallet/${encoded}/sell`,
      icon: TrendingDown,
      title: "Withdraw crypto to your bank account",
    },
  ];
}

function personalMoneyActionRows(encoded: string): ManageActionGroup["rows"] {
  return [
    {
      href: `/app/wallet/${encoded}/buy`,
      icon: Banknote,
      title: "Buy crypto with your bank account",
    },
    {
      href: `/app/wallet/${encoded}/sell`,
      icon: TrendingDown,
      title: "Withdraw crypto to your bank account",
    },
  ];
}

function ActionGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-text-soft">
          {label}
        </h3>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-text-soft/80">
            {description}
          </p>
        ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function ActionRow({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  body?: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group relative flex min-h-[64px] items-center gap-3 overflow-hidden rounded-card border border-border-soft bg-surface-raised px-4 py-3 shadow-card-rest " +
        "transition-[transform,border-color,box-shadow,background-color] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/35 hover:bg-canvas hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent opacity-0 transition-opacity duration-base group-hover:opacity-100"
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-colors duration-base group-hover:bg-accent/15">
        <Icon className="h-4 w-4" strokeWidth={1.85} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-strong">
          {title}
        </p>
        {body ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-text-soft">
            {body}
          </p>
        ) : null}
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas/70 text-text-soft transition-[color,transform] duration-base group-hover:translate-x-0.5 group-hover:text-accent">
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </Link>
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
  const wallet = useWallet();
  const viewerAddress = wallet.publicKey?.toBase58() ?? "";
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
      className="overflow-hidden rounded-card border border-accent/40 bg-surface-raised shadow-card-rest scroll-mt-24"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/20 bg-accent/[0.04] px-5 py-3">
        <span className="inline-flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/15 text-accent">
            <Bell className="h-3 w-3" strokeWidth={2.25} />
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
            Needs your approval
          </span>
          <span className="font-numerals text-[11px] font-semibold tabular-nums text-text-strong">
            {rows.length}
          </span>
        </span>
        {showApproveAll && (
          <BadgePill onClick={handleApproveAll} disabled={running}>
            {running ? "Approving…" : "Approve all"}
          </BadgePill>
        )}
      </header>

      <div className="px-5 py-4">
        {batch.progress && (
          <BatchProgressRow progress={batch.progress} onDismiss={batch.reset} />
        )}
        {!batch.progress && rows.length > 0 && (
          <p className="text-[11px] text-text-soft">
            Approving fires one wallet popup per request. Tap Approve in each.
          </p>
        )}

        <ul className="mt-3 flex flex-col divide-y divide-border-soft">
          {rows.map((row) => {
            const label = row.intentPending
              ? "New request · details loading"
              : friendlyIntentLabel(row.intentTemplate);
            const who = proposerDisplayName(row.proposer, viewerAddress);
            const ago = relativeTime(row.proposedAt);
            const tally =
              row.approverCount > 0
                ? `${row.approvalsCollected} of ${row.approverCount} approved`
                : "awaiting approval";
            return (
              <li key={row.proposalPda}>
                <Link
                  href={`/app/proposals/${row.proposalPda}`}
                  className={
                    "group flex items-center justify-between gap-3 rounded-soft px-2 py-3 -mx-2 " +
                    "transition-colors duration-base ease-out-soft hover:bg-canvas " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-text-strong">
                      {label}
                    </p>
                    <p className="mt-0.5 truncate text-[11px] text-text-soft">
                      by {who} · {ago} · {tally}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
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
  /// Full unsliced list for this wallet - used by the CSV export
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
  // sticks across page nav. Default expanded - recent activity is
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
  const groupedRows = groupRecentActivityRows(rows);
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
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Recent activity
          </span>
          <span className="font-numerals text-[10px] tabular-nums text-text-soft">
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
                "hover:-translate-y-0.5 hover:text-accent " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
              title="See every request with network and status filters"
            >
              See more
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
                "hover:-translate-y-0.5 hover:text-accent " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
              }
              title="Download every request on this wallet as CSV"
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
          {groupedRows.map(({ row, count }) => (
            <li key={row.proposalPda}>
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
                    {activityGroupTitle(
                      count,
                      friendlyIntentLabel(row.intentTemplate),
                    )}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-soft">
                    <span className={statusTextColor(row.status)}>
                      {friendlyStatus(row.status, row.intentTemplate)}
                    </span>
                    <span aria-hidden="true" className="mx-1.5 text-text-soft">/</span>
                    {relativeTime(row.proposedAt)}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-text-soft/80">
                    On-chain proposal {row.proposalPda.slice(0, 6)}...{row.proposalPda.slice(-6)}
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

function ActivityEmptyState({
  walletName,
  reduce,
}: {
  walletName: string;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(walletName);
  return (
    <motion.section
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        History
      </h2>
      {/* Ghost row - same shape as a real activity row, just muted.
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
        Every move on this wallet - sent, approved, declined - gets a
        row, with the friend who acted and when.
      </p>
      <Link
        href={`/app/wallet/${encoded}/send`}
        className={
          "mt-4 inline-flex min-h-tap items-center justify-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest " +
          "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        }
      >
        Send money
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </motion.section>
  );
}

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

  // No-limit case - saved as null. The render-gate above already
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
        "hover:-translate-y-0.5 " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
        (over
          ? "border-danger/30"
          : hasWalletCap && pct >= 0.8
            ? "border-warning/30"
            : "border-border-soft")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <p className={"text-[11px] font-semibold uppercase tracking-[0.24em] text-" + tone}>
          {over
            ? "Over weekly limit"
            : hasWalletCap
              ? "Weekly limit"
              : "Protection checks"}
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
        <p className="flex items-baseline gap-1.5">
          <span className="font-numerals text-base font-semibold text-text-strong tabular-nums">
            {formatUsd(usage.spentUsd)}
          </span>
          <span className="font-numerals text-xs text-text-soft tabular-nums">
            of {formatUsd(cap)}
          </span>
        </p>
        <p className={"font-numerals text-xs tabular-nums " + (over ? "text-danger" : "text-text-soft")}>
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
