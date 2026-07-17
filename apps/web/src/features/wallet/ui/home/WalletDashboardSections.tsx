"use client";

import { useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Eye,
  Plus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/retail/Button";
import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import {
  activityGroupTitle,
  groupRecentActivityRows,
  type RecentActivityGroup,
} from "@/lib/retail/activityGroups";
import { relativeTime } from "@/lib/util/relativeTime";
import {
  friendlyIntentLabel,
  friendlyStatus,
  statusTextColor,
} from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";
import type { WatchedMembership } from "@/lib/hooks/useWatchedWallets";
import {
  addWatchedWallet,
  removeWatchedWallet,
} from "@/lib/retail/watchedWallets";
import {
  productWorkspaceHomeHref,
  productWorkspaceLabel,
  resolveWalletProductSurface,
  type WalletProductSurface,
} from "@/lib/productWorkspace";
import {
  productSetupHref,
  productSurfaceById,
} from "@/lib/productSurfaces";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";

export function StatCard({
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

//
// When the on-chain memberships fetch fails (RPC blip, connection
// dropped mid-load), we used to render the first-visit CTA which
// tells the user to "Create your first wallet" - for someone who
// already has wallets, that's a dangerous nudge. This card replaces
// the silent fallback with an explicit retry.

export function MembershipsErrorCard({ onRetry }: { onRetry: () => void }) {
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


export function FirstVisitCard({
  selectedSurface,
}: {
  selectedSurface: WalletProductSurface | null;
}) {
  if (!selectedSurface) {
    return (
      <div className="border-y border-border-soft py-6 sm:py-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <Wallet className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-lg font-semibold text-text-strong sm:text-xl">
                Create your first wallet
              </h2>
              <p className="mt-1 text-sm text-text-soft">
                Personal is selected by default. Team and agent setups are one tap away.
              </p>
            </div>
          </div>
          <Link href="/app/wallet/new" className="shrink-0">
            <Button size="md">
              Create wallet
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

export function ProductEmptyState({
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

export function Shimmer({ className }: { className?: string }) {
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


interface RecentActivityProps {
  rows: RecentActivityRow[];
  loading: boolean;
  reduce: boolean;
}

export function RecentActivitySection({ rows, loading, reduce }: RecentActivityProps) {
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


function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
      {children}
    </h2>
  );
}

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

export function WatchedWalletsSection({
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
              aria-label="Wallet name to watch"
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
