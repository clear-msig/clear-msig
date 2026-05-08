"use client";

// Cross-wallet activity feed (Tier-5 #35 + #41).
//
// The per-wallet view at /app/wallet/[name]/activity slices to a
// single wallet. Treasury power-users running multiple wallets
// need a single timeline + a single CSV export across the lot.
// This page is the cross-wallet version — same filter set + an
// additional wallet-scope dropdown.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Download, Search } from "lucide-react";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { useUserIntents } from "@/lib/hooks/useUserIntents";
import { ProposalStatus } from "@/lib/msig";
import { friendlyIntentLabel, friendlyStatus } from "@/lib/retail/labels";
import { friendlyChainName } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { relativeTime } from "@/lib/util/relativeTime";
import {
  buildActivityCsv,
  downloadActivityCsv,
} from "@/lib/retail/exportActivity";
import { Breadcrumb } from "@/components/retail/Breadcrumb";
import { StickyTopBar } from "@/components/retail/StickyTopBar";

type StatusFilter = "all" | "active" | "approved" | "executed" | "cancelled";
type ChainFilter = "all" | "0" | "1" | "2" | "3" | "4";

// localStorage shape — saved on every filter change, hydrated on
// first mount. The search query is intentionally excluded; persisting
// "tx hash from yesterday" across sessions would surprise more users
// than it'd help. Status/chain/wallet are durable preferences ("I
// always want to see Sepolia executes only").
const FILTER_STORAGE_KEY = "clear.activity-filters.v1";
interface PersistedFilters {
  status: StatusFilter;
  chain: ChainFilter;
  wallet: string;
}
function loadFilters(): PersistedFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.status === "string" &&
      typeof parsed.chain === "string" &&
      typeof parsed.wallet === "string"
    ) {
      return parsed as PersistedFilters;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}
function saveFilters(prefs: PersistedFilters): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode */
  }
}

export default function CrossWalletActivityPage() {
  const reduce = useReducedMotion();
  const recent = useRecentActivity(Number.POSITIVE_INFINITY);
  const intents = useUserIntents();

  // Index intents by (walletPda, intentIndex) so Custom proposals
  // pick up their actual chain_kind for the chain filter.
  const chainByIntent = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of intents.rows) {
      m.set(`${it.walletPda}#${it.intentIndex}`, it.chainKind);
    }
    return m;
  }, [intents.rows]);

  // Distinct wallets in the user's activity stream — drives the
  // wallet-scope filter dropdown. Sorted by display name so the
  // dropdown reads alphabetically.
  const wallets = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of recent.allRows) {
      map.set(r.walletName, toDisplayName(r.walletName));
    }
    return Array.from(map.entries())
      .map(([name, display]) => ({ name, display }))
      .sort((a, b) => a.display.localeCompare(b.display));
  }, [recent.allRows]);

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const [walletFilter, setWalletFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Hydrate persisted filters once on mount. SSR doesn't have
  // localStorage so the initial state is "all" by design — a
  // hydration step here flips to the saved values without
  // triggering a layout-shift flash.
  useEffect(() => {
    const saved = loadFilters();
    if (!saved) return;
    setStatusFilter(saved.status as StatusFilter);
    setChainFilter(saved.chain as ChainFilter);
    setWalletFilter(saved.wallet);
  }, []);

  // Save on every change. Cheap (one localStorage write per click)
  // and means a navigate-away-and-back lands in the same view.
  useEffect(() => {
    saveFilters({
      status: statusFilter,
      chain: chainFilter,
      wallet: walletFilter,
    });
  }, [statusFilter, chainFilter, walletFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return recent.allRows.filter((r) => {
      if (walletFilter !== "all" && r.walletName !== walletFilter) {
        return false;
      }
      if (statusFilter !== "all") {
        const want = statusForFilter(statusFilter);
        if (r.status !== want) return false;
      }
      if (chainFilter !== "all") {
        const wantKind = parseInt(chainFilter, 10);
        const rowKind =
          chainByIntent.get(`${r.walletPda}#${r.intentIndex}`) ?? -1;
        if (rowKind !== wantKind) return false;
      }
      if (q) {
        const hay = [
          r.proposalPda,
          r.intentTemplate,
          friendlyIntentLabel(r.intentTemplate),
          r.walletName,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [recent.allRows, statusFilter, chainFilter, walletFilter, chainByIntent, search]);

  const handleExport = () => {
    // No global walletName — the CSV builder will use each row's
    // own r.walletName for the Wallet column AND the time-proximity
    // attempt-join scopes per wallet to avoid cross-wallet matches.
    const csv = buildActivityCsv({ rows: filtered });
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix =
      statusFilter === "all" &&
      chainFilter === "all" &&
      walletFilter === "all" &&
      !search.trim()
        ? "all"
        : "filtered";
    downloadActivityCsv(`clear-msig-activity-${stamp}-${suffix}.csv`, csv);
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const loading = recent.loading || intents.loading;

  return (
    <div className="flex flex-col gap-4">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            { label: "All activity" },
          ]}
        />
      </StickyTopBar>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-3"
      >
        <header className="flex items-baseline justify-between gap-3">
          <div>
            <h1 className="font-display text-display-xs leading-tight text-text-strong">
              All activity
            </h1>
            <p className="mt-1 text-xs text-text-soft">
              Every proposal across every wallet you&rsquo;re a member of.
            </p>
          </div>
          <p className="text-xs text-text-soft">
            {loading
              ? "Loading…"
              : `${filtered.length} of ${recent.allRows.length} request${
                  recent.allRows.length === 1 ? "" : "s"
                }`}
          </p>
        </header>

        <div className="flex flex-col gap-2 rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
          <div className="flex items-center gap-2">
            <Search
              className="h-3.5 w-3.5 shrink-0 text-text-soft"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search wallet, proposal address, or type"
              className={
                "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-2.5 py-1.5 text-xs text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Wallet"
              value={walletFilter}
              onChange={setWalletFilter}
              options={[
                { value: "all", label: "All wallets" },
                ...wallets.map((w) => ({
                  value: w.name,
                  label: w.display || "Wallet",
                })),
              ]}
            />
            <FilterSelect
              label="Status"
              value={statusFilter}
              onChange={(v) => setStatusFilter(v as StatusFilter)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "active", label: "Waiting for approval" },
                { value: "approved", label: "Ready to send" },
                { value: "executed", label: "Sent" },
                { value: "cancelled", label: "Cancelled" },
              ]}
            />
            <FilterSelect
              label="Chain"
              value={chainFilter}
              onChange={(v) => setChainFilter(v as ChainFilter)}
              options={[
                { value: "all", label: "All chains" },
                { value: "0", label: "Solana" },
                { value: "1", label: "Ethereum" },
                { value: "4", label: "Ethereum (ERC-20)" },
                { value: "2", label: "Bitcoin" },
                { value: "3", label: "Zcash" },
              ]}
            />
            <button
              type="button"
              onClick={handleExport}
              disabled={filtered.length === 0}
              className={
                "ml-auto inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft " +
                "transition-[border-color,color,transform] duration-base ease-out-soft " +
                "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
                "disabled:cursor-not-allowed disabled:opacity-50 " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              Export CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center text-sm text-text-soft shadow-card-rest">
            Loading activity…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center text-sm text-text-soft shadow-card-rest">
            {recent.allRows.length === 0
              ? "No activity yet on any of your wallets."
              : "No proposals match these filters."}
          </div>
        ) : (
          <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
            {filtered.map((row) => {
              const chainKind = chainByIntent.get(
                `${row.walletPda}#${row.intentIndex}`,
              );
              return (
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
                        {friendlyIntentLabel(row.intentTemplate)}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-soft">
                        <span className="font-medium text-text-strong">
                          {toDisplayName(row.walletName) || "Wallet"}
                        </span>
                        <span>·</span>
                        <span>{relativeTime(row.proposedAt)}</span>
                        <span>·</span>
                        <span>
                          {friendlyStatus(row.status, row.intentTemplate)}
                        </span>
                        {typeof chainKind === "number" && chainKind >= 0 && (
                          <>
                            <span>·</span>
                            <span>{friendlyChainName(chainKind)}</span>
                          </>
                        )}
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
        )}

        <Link
          href="/app/wallet"
          className={
            "mt-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-xs text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to wallets
        </Link>
      </motion.section>
    </div>
  );
}

function statusForFilter(f: StatusFilter): ProposalStatus {
  switch (f) {
    case "active":
      return ProposalStatus.Active;
    case "approved":
      return ProposalStatus.Approved;
    case "executed":
      return ProposalStatus.Executed;
    case "cancelled":
      return ProposalStatus.Cancelled;
    default:
      return ProposalStatus.Active;
  }
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="inline-flex items-center gap-1.5 text-[11px] text-text-soft">
      <span className="uppercase tracking-[0.18em]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs font-medium text-text-strong outline-none " +
          "transition-[border-color,box-shadow] duration-base ease-out-soft " +
          "focus:border-accent focus:shadow-accent-rest"
        }
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
