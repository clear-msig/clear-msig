"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ChevronDown, Download } from "lucide-react";
import {
  broadcastExplorerUrl,
  txUrl as solanaExplorerTxUrl,
} from "@/lib/explorer";
import type { ChainTxRow } from "@/lib/hooks/useChainTxHistory";
import {
  useBitcoinTxHistory,
  useEvmTxHistory,
  useSolanaTxHistory,
  useZcashTxHistory,
} from "@/lib/hooks/useChainTxHistory";
import { chainAddress, useWalletChains } from "@/lib/hooks/useWalletChains";
import { appConfig } from "@/lib/config";
import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import {
  activityGroupTitle,
  groupRecentActivityRows,
} from "@/lib/retail/activityGroups";
import {
  buildActivityCsv,
  downloadActivityCsv,
} from "@/lib/retail/exportActivity";
import {
  friendlyIntentLabel,
  friendlyStatus,
  statusTextColor,
} from "@/lib/retail/labels";
import type { TxAttempt } from "@/lib/retail/txLog";
import { relativeTime } from "@/lib/util/relativeTime";

export interface ActivityPanelProps {
  rows: RecentActivityRow[];
  allRows: RecentActivityRow[];
  walletName: string;
  attempts: TxAttempt[];
  solanaVaultAddress: string | null;
  reduce: boolean;
}

export function ActivityPanel({
  rows,
  allRows,
  walletName,
  attempts,
  solanaVaultAddress,
  reduce,
}: ActivityPanelProps) {
  const chains = useWalletChains(walletName);
  const addressFor = (kind: number) => {
    const binding = (chains.data?.chains ?? []).find((row) =>
      kind === 1
        ? row.chain_kind === 1 || row.chain_kind === 4 || row.chain_kind === 5
        : row.chain_kind === kind,
    );
    return binding ? chainAddress(binding) : null;
  };
  const solana = useSolanaTxHistory(solanaVaultAddress, 8);
  const evm = useEvmTxHistory(addressFor(1), 8);
  const btc = useBitcoinTxHistory(addressFor(2), 8);
  const zcash = useZcashTxHistory(
    addressFor(3),
    appConfig.preAlpha.zcashRpcUrl,
    8,
  );
  const histories = [
    { rows: solana.data ?? [], ticker: "SOL", kind: 0 },
    { rows: evm.data ?? [], ticker: "ETH", kind: 1 },
    { rows: btc.data ?? [], ticker: "BTC", kind: 2 },
    { rows: zcash.data ?? [], ticker: "ZEC", kind: 3 },
  ];
  return (
    <div
      id="wallet-tab-panel-activity"
      role="tabpanel"
      aria-labelledby="wallet-tab-activity"
      className="flex flex-col gap-4"
    >
      {attempts.length > 0 ? (
        <SendAttempts rows={attempts} reduce={reduce} />
      ) : null}
      {rows.length > 0 ? (
        <ProposalActivity
          rows={rows}
          allRows={allRows}
          walletName={walletName}
          attempts={attempts}
          reduce={reduce}
        />
      ) : (
        <ActivityEmptyState walletName={walletName} reduce={reduce} />
      )}
      {histories.map((history) =>
        history.rows.length > 0 ? (
          <ChainHistory
            key={history.ticker}
            rows={history.rows}
            chainTicker={history.ticker}
            chainKind={history.kind}
            reduce={reduce}
          />
        ) : null,
      )}
    </div>
  );
}

function SendAttempts({ rows, reduce }: { rows: TxAttempt[]; reduce: boolean }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <Panel reduce={reduce}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">Send attempts</h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((row) => {
          const isOpen = expanded === row.id;
          return (
            <li key={row.id} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-text-strong">
                    <span
                      className={row.status === "success" ? "text-accent" : "text-warning"}
                    >
                      {row.status === "success" ? "Confirmed" : "Failed"}
                    </span>
                    {` · ${row.amountDisplay ?? "-"} ${row.ticker ?? ""}`}
                    {row.recipientShort ? ` to ${row.recipientShort}` : ""}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-text-soft">
                    {relativeTime(row.ts)}
                    {row.status === "failed" && row.errorBrief
                      ? ` · ${row.errorBrief}`
                      : ""}
                  </p>
                </div>
                {row.status === "success" && row.explorerUrl ? (
                  <ExternalAction href={row.explorerUrl}>View transaction</ExternalAction>
                ) : row.status === "failed" && row.errorStderr ? (
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : row.id)}
                    aria-expanded={isOpen}
                    className="min-h-11 shrink-0 rounded-full border border-border-soft bg-canvas px-3 text-[11px] font-medium text-text-strong transition-colors hover:border-warning/50 hover:text-warning"
                  >
                    {isOpen ? "Hide details" : "Show details"}
                  </button>
                ) : null}
              </div>
              {row.status === "failed" && isOpen && row.errorStderr ? (
                <pre className="mt-2 max-h-48 overflow-auto rounded-soft border border-border-soft bg-canvas px-3 py-2 font-mono text-[11px] leading-relaxed text-text-soft">
                  {row.errorStderr}
                </pre>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ChainHistory({
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
  return (
    <Panel reduce={reduce}>
      <header className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-text-strong">
          {chainTicker} transactions
        </h2>
        <span className="text-xs text-text-soft">{rows.length}</span>
      </header>
      <ul className="mt-3 flex flex-col divide-y divide-border-soft">
        {rows.map((row) => {
          const timestamp =
            row.ts !== null ? relativeTime(row.ts * 1000) : `slot ${row.slot}`;
          const failed = row.status === "failed";
          const explorerUrl =
            chainKind === 0
              ? solanaExplorerTxUrl(row.txId)
              : broadcastExplorerUrl({ chain_kind: chainKind, tx_id: row.txId });
          return (
            <li key={row.txId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-text-strong">
                  <span className={failed ? "text-warning" : "text-accent"}>
                    {failed ? "Failed" : "Confirmed"}
                  </span>
                  <span className="font-mono text-xs text-text-soft">
                    {` · ${row.txId.slice(0, 6)}...${row.txId.slice(-6)}`}
                  </span>
                </p>
                <p className="mt-0.5 truncate text-xs text-text-soft">
                  {timestamp}
                  {failed && row.errorBrief ? ` · ${row.errorBrief}` : ""}
                </p>
              </div>
              {explorerUrl ? (
                <ExternalAction href={explorerUrl}>View</ExternalAction>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function ProposalActivity({
  rows,
  allRows,
  walletName,
  attempts,
  reduce,
}: {
  rows: RecentActivityRow[];
  allRows: RecentActivityRow[];
  walletName: string;
  attempts: TxAttempt[];
  reduce: boolean;
}) {
  const collapsedKey = `clear.activity-collapsed.${walletName}`;
  const [collapsed, setCollapsed] = useState(() => {
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
      // Storage is optional; local state still works.
    }
  };
  const handleExport = () => {
    const csv = buildActivityCsv({ walletName, rows: allRows, attempts });
    const slug = walletName.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadActivityCsv(`clear-msig-${slug || "wallet"}-${stamp}.csv`, csv);
  };
  const groupedRows = groupRecentActivityRows(rows);

  return (
    <motion.section
      initial={reduce ? undefined : { opacity: 0, y: 8 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-controls="recent-activity-list"
          className="group -mx-1 inline-flex min-h-11 items-center gap-1.5 rounded-soft px-1 transition-colors duration-base ease-out-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 text-text-soft transition-transform duration-base ${collapsed ? "-rotate-90" : "rotate-0"}`}
            strokeWidth={2.5}
            aria-hidden="true"
          />
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Requests
          </span>
          <span className="font-numerals text-[10px] tabular-nums text-text-soft">
            {allRows.length}
          </span>
        </button>
        {!collapsed ? (
          <div className="flex items-center gap-1.5">
            {allRows.length > rows.length ? (
              <Link
                href={`/app/wallet/${encodeURIComponent(walletName)}/activity`}
                className="inline-flex min-h-11 items-center gap-1 rounded-full border border-border-soft bg-surface-raised px-3 text-[11px] font-medium text-text-soft transition-[border-color,color] hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                See all
                <ArrowRight className="h-3 w-3" aria-hidden="true" />
              </Link>
            ) : null}
            <button
              type="button"
              onClick={handleExport}
              aria-label="Export wallet activity as CSV"
              title="Export CSV"
              className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-border-soft bg-surface-raised text-text-soft transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <Download className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>
      {!collapsed ? (
        <ul
          id="recent-activity-list"
          className="mt-3 flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest"
        >
          {groupedRows.map(({ row, count }) => (
            <li key={row.proposalPda}>
              <Link
                href={`/app/proposals/${row.proposalPda}`}
                className="group flex min-h-14 items-center justify-between gap-3 px-5 py-3 transition-colors duration-base ease-out-soft hover:bg-canvas focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
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
                    {` · ${relativeTime(row.proposedAt)}`}
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
      ) : null}
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
  return (
    <Panel reduce={reduce}>
      <h2 className="text-sm font-medium text-text-strong">No activity yet</h2>
      <p className="mt-1 text-xs text-text-soft">
        Sends, approvals, and declined requests will appear here.
      </p>
      <Link
        href={`/app/wallet/${encodeURIComponent(walletName)}/send`}
        className="mt-4 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-soft bg-accent px-3.5 py-2 text-sm font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      >
        Send money
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </Panel>
  );
}

function Panel({
  reduce,
  children,
}: {
  reduce: boolean;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={reduce ? undefined : { opacity: 0, y: 8 }}
      animate={reduce ? undefined : { opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      {children}
    </motion.section>
  );
}

function ExternalAction({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-border-soft bg-canvas px-3 text-[11px] font-medium text-text-strong transition-colors hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {children}
    </a>
  );
}
