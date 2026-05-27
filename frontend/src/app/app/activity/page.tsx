"use client";

// Cross-wallet activity feed.
//
// User-first redesign:
//   • Compact left-aligned header (no kicker) - consistent with the
//     new Home hero.
//   • Status stats row (Waiting / Ready / Sent / Cancelled). The tiles
//     ARE the status filter - clicking one toggles. Counts surface at
//     the top so the user can pick the bucket they care about before
//     touching any select.
//   • Search row + chip-style secondary filters (wallet, chain) +
//     Export CSV action.
//   • List rows lead with a color-coded status dot for at-a-glance
//     scannability.
//
// Hooks + filter logic + CSV export + localStorage persistence are
// untouched; this file only changes presentation.

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import clsx from "clsx";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Search,
  Send,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { useUserIntents } from "@/lib/hooks/useUserIntents";
import { ProposalStatus } from "@/lib/msig";
import { friendlyIntentLabel, friendlyStatus, statusTextColor } from "@/lib/retail/labels";
import { friendlyChainName } from "@/lib/retail/chains";
import { toDisplayName } from "@/lib/retail/walletNames";
import { relativeTime } from "@/lib/util/relativeTime";
import {
  buildActivityCsv,
  downloadActivityCsv,
} from "@/lib/retail/exportActivity";

type StatusFilter = "all" | "active" | "approved" | "executed" | "cancelled";
type ChainFilter = "all" | "0" | "1" | "2" | "3" | "4";

// localStorage shape - saved on every filter change, hydrated on
// first mount. The search query is intentionally excluded; persisting
// "tx hash from yesterday" across sessions would surprise more users
// than it'd help.
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

  // Distinct wallets in the user's activity stream - drives the
  // wallet-scope filter dropdown.
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

  useEffect(() => {
    const saved = loadFilters();
    if (!saved) return;
    setStatusFilter(saved.status as StatusFilter);
    setChainFilter(saved.chain as ChainFilter);
    setWalletFilter(saved.wallet);
  }, []);

  useEffect(() => {
    saveFilters({
      status: statusFilter,
      chain: chainFilter,
      wallet: walletFilter,
    });
  }, [statusFilter, chainFilter, walletFilter]);

  // Status counts power both the stats tiles and the badge in the
  // export button. Single pass over allRows.
  const counts = useMemo(() => {
    const c = { active: 0, approved: 0, executed: 0, cancelled: 0 };
    for (const r of recent.allRows) {
      if (r.status === ProposalStatus.Active) c.active++;
      else if (r.status === ProposalStatus.Approved) c.approved++;
      else if (r.status === ProposalStatus.Executed) c.executed++;
      else if (r.status === ProposalStatus.Cancelled) c.cancelled++;
    }
    return c;
  }, [recent.allRows]);

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

  const clearFilters = () => {
    setStatusFilter("all");
    setChainFilter("all");
    setWalletFilter("all");
    setSearch("");
  };

  const loading = recent.loading || intents.loading;
  const hasActivity = recent.allRows.length > 0;

  return (
    <div className="flex flex-col gap-6">
      <Hero
        filteredCount={filtered.length}
        totalCount={recent.allRows.length}
        loading={loading}
        reduce={!!reduce}
      />

      {hasActivity && (
        <StatusStatsRow
          counts={counts}
          activeFilter={statusFilter}
          onSelect={setStatusFilter}
          reduce={!!reduce}
        />
      )}

      <FilterBar
        search={search}
        onSearchChange={setSearch}
        wallets={wallets}
        walletFilter={walletFilter}
        onWalletChange={setWalletFilter}
        chainFilter={chainFilter}
        onChainChange={(v) => setChainFilter(v as ChainFilter)}
        onExport={handleExport}
        canExport={filtered.length > 0}
      />

      <ActivityList
        rows={filtered}
        chainByIntent={chainByIntent}
        loading={loading}
        emptyKind={hasActivity ? "no-match" : "no-activity"}
        onClearFilters={clearFilters}
      />
    </div>
  );
}

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({
  filteredCount,
  totalCount,
  loading,
  reduce,
}: {
  filteredCount: number;
  totalCount: number;
  loading: boolean;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const summary = loading
    ? "Loading…"
    : totalCount === 0
      ? "Nothing yet - no requests across your wallets."
      : `${filteredCount} of ${totalCount} request${totalCount === 1 ? "" : "s"}`;
  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1"
    >
      <div className="flex flex-col gap-1">
        <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
          All activity
        </h1>
        <p className="text-xs text-text-soft sm:text-sm">
          Every request across the wallets you&rsquo;re a member of.
        </p>
      </div>
      <p className="text-xs text-text-soft sm:text-sm">{summary}</p>
    </motion.div>
  );
}

// ─── Status stats ──────────────────────────────────────────────────

type StatusKey = "active" | "approved" | "executed" | "cancelled";

interface StatusTile {
  key: StatusKey;
  label: string;
  Icon: LucideIcon;
}

const STATUS_TILES: StatusTile[] = [
  { key: "active", label: "Waiting", Icon: Bell },
  { key: "approved", label: "Ready to send", Icon: Send },
  { key: "executed", label: "Sent", Icon: CheckCircle2 },
  { key: "cancelled", label: "Cancelled", Icon: XCircle },
];

function StatusStatsRow({
  counts,
  activeFilter,
  onSelect,
  reduce,
}: {
  counts: Record<StatusKey, number>;
  activeFilter: StatusFilter;
  onSelect: (next: StatusFilter) => void;
  reduce: boolean;
}) {
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2 }}
      className="grid grid-cols-2 gap-3 sm:grid-cols-4"
    >
      {STATUS_TILES.map((tile) => {
        const count = counts[tile.key];
        const active = activeFilter === tile.key;
        const disabled = count === 0 && !active;
        return (
          <button
            key={tile.key}
            type="button"
            onClick={() => onSelect(active ? "all" : tile.key)}
            aria-pressed={active}
            disabled={disabled}
            className={clsx(
              "group flex flex-col items-start gap-2 rounded-card border bg-surface-raised p-4 text-left shadow-card-rest",
              "transition-[border-color,transform,box-shadow,opacity] duration-base ease-out-soft",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              !disabled &&
                "hover:-translate-y-0.5 hover:shadow-card-raised",
              disabled && "cursor-not-allowed opacity-50",
              active ? "border-accent/40" : "border-border-soft",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <span
                className={clsx(
                  "flex h-7 w-7 items-center justify-center rounded-full",
                  "transition-colors duration-base ease-out-soft",
                  active
                    ? "bg-accent/15 text-accent"
                    : "bg-glass-soft text-text-soft",
                )}
              >
                <tile.Icon
                  className="h-3.5 w-3.5"
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </span>
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
                {tile.label}
              </span>
            </div>
            <p
              className={clsx(
                "font-numerals text-2xl font-semibold tabular-nums leading-tight",
                active ? "text-accent" : "text-text-strong",
              )}
            >
              {count}
            </p>
          </button>
        );
      })}
    </motion.div>
  );
}

// ─── Filter bar ────────────────────────────────────────────────────

function FilterBar({
  search,
  onSearchChange,
  wallets,
  walletFilter,
  onWalletChange,
  chainFilter,
  onChainChange,
  onExport,
  canExport,
}: {
  search: string;
  onSearchChange: (v: string) => void;
  wallets: { name: string; display: string }[];
  walletFilter: string;
  onWalletChange: (v: string) => void;
  chainFilter: string;
  onChainChange: (v: string) => void;
  onExport: () => void;
  canExport: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      {/* Search - full width with leading icon. */}
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-soft"
          aria-hidden="true"
        />
        <input
          type="search"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Search by wallet, address, or type…"
          className={clsx(
            "w-full rounded-soft border border-border-soft bg-canvas py-2 pl-9 pr-3 text-sm text-text-strong outline-none",
            "transition-[border-color,box-shadow] duration-base ease-out-soft",
            "placeholder:text-text-soft/60",
            "focus:border-accent focus:shadow-accent-rest",
          )}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterDropdown
          label="Wallet"
          value={walletFilter}
          onChange={onWalletChange}
          options={[
            { value: "all", label: "All wallets" },
            ...wallets.map((w) => ({
              value: w.name,
              label: w.display || "Wallet",
            })),
          ]}
        />
        <FilterDropdown
          label="Chain"
          value={chainFilter}
          onChange={onChainChange}
          options={[
            { value: "all", label: "All networks" },
            { value: "0", label: "Solana" },
            { value: "1", label: "Ethereum" },
            { value: "4", label: "Ethereum (ERC-20)" },
            { value: "2", label: "Bitcoin" },
            { value: "3", label: "Zcash" },
          ]}
        />
        <button
          type="button"
          onClick={onExport}
          disabled={!canExport}
          className={clsx(
            "ml-auto inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft",
            "transition-colors duration-base ease-out-soft",
            "hover:text-text-strong",
            "disabled:cursor-not-allowed disabled:opacity-50",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          Export CSV
        </button>
      </div>
    </div>
  );
}

// ─── Branded dropdown ──────────────────────────────────────────────
//
// Native <select> ships an OS-default popover that ignores our dark
// canvas, accent palette, font stack, and shadow tokens. This is a
// fully-controlled replacement that:
//   • matches the chip surface - same border + canvas bg, accent
//     border on open, chevron rotates 180°.
//   • highlights the current value with accent + a check glyph.
//   • supports click-outside, Esc to close, ↑/↓ Home/End to navigate,
//     Enter to select, Tab to move out cleanly.
//   • scrolls if the list grows past 14rem (the wallet picker can
//     grow to a dozen entries on multi-org users).

function FilterDropdown({
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
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = options.find((o) => o.value === value);
  const isDefault = value === "all";

  // Close on outside click + Esc anywhere on the page.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // When the menu opens, seed the highlight to the current value so
  // arrow keys feel oriented from the start.
  useEffect(() => {
    if (!open) {
      setHighlight(-1);
      return;
    }
    const i = options.findIndex((o) => o.value === value);
    setHighlight(i >= 0 ? i : 0);
  }, [open, options, value]);

  // Move focus to the highlighted option so Enter selects it.
  useEffect(() => {
    if (!open || highlight < 0) return;
    optionRefs.current[highlight]?.focus({ preventScroll: false });
  }, [open, highlight]);

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(options.length - 1);
    } else if (e.key === "Tab") {
      // Let Tab propagate so focus moves out naturally.
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label} filter`}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-soft border bg-canvas px-2.5 py-1.5",
          "transition-colors duration-base ease-out-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          open
            ? "border-accent/40"
            : "border-border-soft hover:border-border-strong",
        )}
      >
        <span className="text-[11px] text-text-soft">{label}:</span>
        <span
          className={clsx(
            "max-w-[10rem] truncate text-xs font-medium",
            isDefault ? "text-text-strong" : "text-accent",
          )}
        >
          {selected?.label ?? "-"}
        </span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={clsx(
            "transition-transform duration-base ease-out-soft",
            open ? "rotate-180 text-text-strong" : "text-text-soft",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            className={clsx(
              "absolute left-0 top-[calc(100%+6px)] z-50 min-w-[12rem] max-w-[18rem]",
              "max-h-[14rem] overflow-y-auto overflow-x-hidden",
              "rounded-card border border-border-soft bg-surface-raised py-1 shadow-card-raised",
            )}
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              const isHighlighted = i === highlight;
              return (
                <button
                  key={o.value}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs",
                    "transition-colors duration-base ease-out-soft focus:outline-none",
                    isSelected ? "font-medium text-accent" : "text-text-strong",
                    isHighlighted &&
                      (isSelected ? "bg-accent/10" : "bg-glass-soft"),
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {isSelected && (
                    <Check
                      size={12}
                      strokeWidth={2.5}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Activity list ─────────────────────────────────────────────────

interface ActivityRowData {
  walletPda: string;
  walletName: string;
  proposalPda: string;
  intentIndex: number;
  intentTemplate: string;
  status: ProposalStatus;
  proposedAt: bigint;
}

function ActivityList({
  rows,
  chainByIntent,
  loading,
  emptyKind,
  onClearFilters,
}: {
  rows: ActivityRowData[];
  chainByIntent: Map<string, number>;
  loading: boolean;
  emptyKind: "no-activity" | "no-match";
  onClearFilters: () => void;
}) {
  if (loading) {
    return (
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center text-sm text-text-soft shadow-card-rest">
        Loading activity…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
        {emptyKind === "no-activity" ? (
          <p className="text-sm text-text-soft">
            No activity yet on any of your wallets.
            <span className="mt-1 block">
              Create or open a wallet, then send your first request.
            </span>
          </p>
        ) : (
          <>
            <p className="text-sm text-text-soft">
              No requests match these filters.
            </p>
            <button
              type="button"
              onClick={onClearFilters}
              className={clsx(
                "mt-3 inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft",
                "transition-colors duration-base ease-out-soft hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              )}
            >
              Clear filters
            </button>
          </>
        )}
      </div>
    );
  }

  return (
    <ul className="flex flex-col divide-y divide-border-soft rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      {rows.map((row) => {
        const chainKind = chainByIntent.get(
          `${row.walletPda}#${row.intentIndex}`,
        );
        return (
          <ActivityRowItem key={row.proposalPda} row={row} chainKind={chainKind} />
        );
      })}
    </ul>
  );
}

function ActivityRowItem({
  row,
  chainKind,
}: {
  row: ActivityRowData;
  chainKind: number | undefined;
}) {
  return (
    <li>
      <Link
        href={`/app/proposals/${row.proposalPda}`}
        className={clsx(
          "group flex items-center justify-between gap-3 px-5 py-3.5",
          "transition-colors duration-base ease-out-soft hover:bg-canvas",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <StatusDot status={row.status} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-text-strong">
              {friendlyIntentLabel(row.intentTemplate)}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-text-soft">
              <span className="font-medium text-text-strong">
                {toDisplayName(row.walletName) || "Wallet"}
              </span>
              <span aria-hidden="true">·</span>
              <span className={statusTextColor(row.status)}>
                {friendlyStatus(row.status, row.intentTemplate)}
              </span>
              <span aria-hidden="true">·</span>
              <span>{relativeTime(row.proposedAt)}</span>
              {typeof chainKind === "number" && chainKind >= 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{friendlyChainName(chainKind)}</span>
                </>
              )}
            </p>
          </div>
        </div>
        <ArrowRight
          className="h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
          aria-hidden="true"
        />
      </Link>
    </li>
  );
}

function StatusDot({ status }: { status: ProposalStatus }) {
  const tone = (() => {
    switch (status) {
      case ProposalStatus.Active:
        return "bg-warning";
      case ProposalStatus.Approved:
        return "bg-accent";
      case ProposalStatus.Executed:
        return "bg-text-soft/60";
      case ProposalStatus.Cancelled:
      default:
        return "bg-text-soft/30";
    }
  })();
  return (
    <span
      aria-hidden="true"
      className="mt-1.5 flex h-2 w-2 shrink-0 items-center justify-center"
    >
      <span className={clsx("block h-2 w-2 rounded-full", tone)} />
    </span>
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
