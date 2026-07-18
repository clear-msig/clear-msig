"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Banknote,
  Bell,
  Coins,
  Download,
  FileCheck2,
  Network,
  ReceiptText,
  Repeat2,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  ActionButton,
  ActionGroup,
  ActionRow,
} from "@/components/wallet/detail/ManageActionPrimitives";
import type { ActionNeededRow } from "@/lib/hooks/useActionNeeded";
import type { RecentActivityRow } from "@/lib/hooks/useRecentActivity";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import {
  buildActivityCsv,
  downloadActivityCsv,
} from "@/lib/retail/exportActivity";
import { formatUsd } from "@/lib/retail/priceConversion";
import type { TxAttempt } from "@/lib/retail/txLog";
import {
  buildProAccountingCsv,
  downloadProAccountingCsv,
  getProTreasuryRuntime,
  useProSchedules,
} from "@/lib/pro/treasury";
import { useProAuditEvents } from "@/lib/pro/audit";

export interface ProTreasuryPanelProps {
  name: string;
  actionRows: ActionNeededRow[];
  activityRows: RecentActivityRow[];
  attempts: TxAttempt[];
  reduce: boolean;
}

export function ProTreasuryPanel(props: ProTreasuryPanelProps) {
  return (
    <>
      <ProOperationsPanel {...props} />
      <BudgetStripe name={props.name} />
    </>
  );
}
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
  type ProPanelKey =
    | "payments"
    | "protection"
    | "audit"
    | "admin";
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(name);
  const runtime = useMemo(() => getProTreasuryRuntime(), []);
  const schedules = useProSchedules(name);
  const auditEvents = useProAuditEvents(name);
  const budgetUsage = useWalletBudgetUsage(name);
  const [activePanel, setActivePanel] = useState<ProPanelKey | null>(null);
  const lastReceipt = attempts[0] ?? null;
  const limitsReady = hasAnyProLimit(budgetUsage);
  const commandTiles: Array<{
    key: ProPanelKey;
    label: string;
    value: string;
    icon: LucideIcon;
  }> = [
    {
      key: "payments",
      label: "Payments",
      value: schedules.rows.length > 0 ? `${schedules.rows.length} scheduled` : "Pay out",
      icon: Banknote,
    },
    {
      key: "protection",
      label: "Protection",
      value: limitsReady ? "Set" : "Set up",
      icon: ShieldCheck,
    },
    {
      key: "admin",
      label: "Admin",
      value: activityRows.length + attempts.length > 0 ? "Audit ready" : "Settings",
      icon: SettingsIcon,
    },
  ];


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
      className="flex flex-col gap-3"
      aria-label="Pro treasury operations"
    >
      <div className="rounded-card border border-accent/25 bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-accent">
              Pro command center · {runtime.environmentLabel}
            </p>
            <h2 className="mt-1 font-display text-xl leading-tight text-text-strong">
              Choose one action.
            </h2>
          </div>
          {actionRows.length > 0 ? (
            <Link
              href="#action-needed"
              className={
                "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-text-on-accent shadow-accent-rest " +
                "transition-[background-color,transform] duration-base ease-out-soft hover:bg-accent-hover active:scale-[0.98] " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
              }
            >
              Approval queue
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-3">
          {commandTiles.map(({ key, label, value, icon: Icon }) => {
            const selected = activePanel === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActivePanel(key)}
                className={
                  "flex min-h-[76px] items-center gap-3 rounded-card border px-3 py-3 text-left transition-[border-color,background-color,transform] duration-base ease-out-soft active:scale-[0.98] " +
                  (selected
                    ? "border-accent/55 bg-accent/10"
                    : "border-border-soft bg-canvas/70 hover:border-accent/35")
                }
                aria-pressed={selected}
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-strong">
                    {label}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-text-soft">
                    {value}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {activePanel === "payments" ? (
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
          <ActionRow
            href={`/app/wallet/${encoded}/recurring`}
            icon={Repeat2}
            title="Recurring"
          />
        </ActionGroup>
      ) : null}

      {activePanel === "protection" ? (
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
      ) : null}

      {activePanel === "audit" ? (
        <ProAuditCard
          activityCount={activityRows.length + (auditEvents.data?.length ?? 0)}
          lastReceipt={lastReceipt}
          latestBackendEvent={auditEvents.data?.[0]?.title ?? null}
          onExport={exportAudit}
          onExportAccounting={exportAccounting}
          activityHref={`/app/wallet/${encoded}/activity`}
          csvColumns={runtime.batchCsvColumns}
          accountingTargets={runtime.accountingTargets}
        />
      ) : null}

      {activePanel === "admin" ? (
        <ActionGroup label="Admin">
          <ActionButton
            icon={ReceiptText}
            title="Audit export"
            onClick={() => setActivePanel("audit")}
          />
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
      ) : null}
    </motion.section>
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

function ProAuditCard({
  activityCount,
  lastReceipt,
  latestBackendEvent,
  onExport,
  onExportAccounting,
  activityHref,
  csvColumns,
  accountingTargets,
}: {
  activityCount: number;
  lastReceipt: TxAttempt | null;
  latestBackendEvent: string | null;
  onExport: () => void;
  onExportAccounting: () => void;
  activityHref: string;
  csvColumns: string[];
  accountingTargets: string[];
}) {
  const receiptCopy = lastReceipt
    ? humanReceipt(lastReceipt)
    : latestBackendEvent ?? "Receipts appear after sends and approvals.";

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
        aria-label="Wallet spending limit used"
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
                  aria-label={`${c.ticker} spending limit used`}
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
