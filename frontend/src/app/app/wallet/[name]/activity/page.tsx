"use client";

// Wallet activity — full-page view of every proposal on this wallet.
//
// The dashboard's Recent activity section (in /app/wallet/[name]) caps
// at top-5; treasury managers with multiple wallets and dozens of
// proposals need a place to slice by chain + status, search by
// proposal address, and export to CSV. This is that place.
//
// Same data source (useRecentActivity), additionally joined with
// useUserIntents so we can attach a chain hint to each row — Custom
// intents land in the row stream as "Custom" without a chain, and
// without that join the chain filter would be useless.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Download, Search } from "lucide-react";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { useUserIntents } from "@/lib/hooks/useUserIntents";
import { useTxAttempts } from "@/lib/hooks/useTxAttempts";
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
import { BackToWallets } from "@/components/retail/BackToWallets";

type StatusFilter = "all" | "active" | "approved" | "executed" | "cancelled";
type ChainFilter = "all" | "0" | "1" | "2" | "3" | "4";

export default function WalletActivityPage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const reduce = useReducedMotion();
  const recent = useRecentActivity(Number.POSITIVE_INFINITY);
  const intents = useUserIntents();
  const attempts = useTxAttempts(name, Number.POSITIVE_INFINITY);

  // Index intents by (walletPda, intentIndex) so we can attach a
  // chain hint to each Custom proposal row. Built once per
  // intents-query update.
  const chainByIntent = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of intents.rows) {
      m.set(`${it.walletPda}#${it.intentIndex}`, it.chainKind);
    }
    return m;
  }, [intents.rows]);

  const allRows = useMemo(
    () => recent.allRows.filter((r) => r.walletName === name),
    [recent.allRows, name],
  );

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [chainFilter, setChainFilter] = useState<ChainFilter>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allRows.filter((r) => {
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
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [allRows, statusFilter, chainFilter, chainByIntent, search]);

  const handleExport = () => {
    const csv = buildActivityCsv({
      walletName: name,
      rows: filtered,
      attempts,
    });
    const slug = name.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);
    const suffix =
      statusFilter === "all" && chainFilter === "all" && !search.trim()
        ? ""
        : "-filtered";
    downloadActivityCsv(
      `clear-msig-${slug || "wallet"}-${stamp}${suffix}.csv`,
      csv,
    );
  };

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const walletDisplay = toDisplayName(name);
  const loading = recent.loading || intents.loading;

  return (
    <div className="flex flex-col gap-4">
      <StickyTopBar offset="header">
        <Breadcrumb
          segments={[
            { label: "Wallets", href: "/app/wallet" },
            {
              label: walletDisplay || "Wallet",
              href: `/app/wallet/${encodeURIComponent(name)}`,
            },
            { label: "Activity" },
          ]}
        />
      </StickyTopBar>
      {/* Mobile-only back chip — see /send for rationale. */}
      <div className="px-gutter pt-2 md:hidden">
        <BackToWallets />
      </div>

      <motion.section
        {...motionProps}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col gap-3"
      >
        <header className="flex items-baseline justify-between gap-3">
          <div className="flex flex-col">
            <span aria-hidden="true" className="block h-px w-10 bg-accent" />
            <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Wallet activity
            </p>
            <h1 className="mt-2 font-display text-display-xs leading-tight text-text-strong">
              Activity
            </h1>
          </div>
          <p className="font-numerals text-xs text-text-soft tabular-nums">
            {loading
              ? "Loading…"
              : `${filtered.length} of ${allRows.length} request${allRows.length === 1 ? "" : "s"}`}
          </p>
        </header>

        {/* Filter bar */}
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
              placeholder="Search proposal address or type"
              className={
                "min-w-0 flex-1 rounded-soft border border-border-soft bg-canvas px-2.5 py-1.5 text-xs text-text-strong outline-none " +
                "transition-[border-color,box-shadow] duration-base ease-out-soft " +
                "focus:border-accent focus:shadow-accent-rest"
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
                "ml-auto inline-flex min-h-tap items-center justify-center gap-1 rounded-full border border-border-soft bg-canvas px-3 py-2 text-[11px] font-medium text-text-soft " +
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

        {/* Rows */}
        {loading ? (
          <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center text-sm text-text-soft shadow-card-rest">
            Loading activity…
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
            {allRows.length === 0 ? (
              <p className="text-sm text-text-soft">
                No activity yet on this wallet.
              </p>
            ) : (
              <>
                <p className="text-sm text-text-soft">
                  No proposals match these filters.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter("all");
                    setChainFilter("all");
                    setSearch("");
                  }}
                  className={
                    "mt-3 inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full border border-border-soft bg-canvas px-4 py-2 text-xs font-medium text-text-soft " +
                    "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  Clear filters
                </button>
              </>
            )}
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
                      "transition-colors duration-base ease-out-soft hover:bg-canvas " +
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset"
                    }
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-strong">
                        {friendlyIntentLabel(row.intentTemplate)}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-soft">
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
          href={`/app/wallet/${encodeURIComponent(name)}`}
          className={
            "mt-2 inline-flex w-fit items-center gap-1.5 rounded-soft px-2 py-1 text-xs text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-3 w-3" aria-hidden="true" />
          Back to {walletDisplay || "wallet"}
        </Link>
      </motion.section>
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────

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
      <span className="uppercase tracking-[0.24em]">{label}</span>
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
