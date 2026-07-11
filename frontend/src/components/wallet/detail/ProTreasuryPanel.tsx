"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  Banknote,
  Bell,
  Bot,
  Coins,
  Download,
  FileCheck2,
  Network,
  ReceiptText,
  Repeat2,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  TrendingDown,
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
import { useContacts } from "@/lib/hooks/useContacts";
import { useWalletBudgetUsage } from "@/lib/hooks/useWalletBudgetUsage";
import {
  isValidSolanaAddress,
  shortAddress,
} from "@/lib/retail/contacts";
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
  type ProSchedule,
} from "@/lib/pro/treasury";

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
    | "recurring"
    | "protection"
    | "automation"
    | "audit"
    | "admin";
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const encoded = encodeURIComponent(name);
  const runtime = useMemo(() => getProTreasuryRuntime(), []);
  const schedules = useProSchedules(name);
  const budgetUsage = useWalletBudgetUsage(name);
  const [activePanel, setActivePanel] = useState<ProPanelKey | null>(null);
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
  const commandTiles: Array<{
    key: ProPanelKey;
    label: string;
    value: string;
    icon: LucideIcon;
  }> = [
    {
      key: "payments",
      label: "Payments",
      value: dueSchedules.length > 0 ? `${dueSchedules.length} due` : "Pay out",
      icon: Banknote,
    },
    {
      key: "protection",
      label: "Protection",
      value: limitsReady ? "Set" : "Set up",
      icon: ShieldCheck,
    },
    {
      key: "automation",
      label: "Automation",
      value: "Agents",
      icon: Bot,
    },
    {
      key: "admin",
      label: "Admin",
      value: activityRows.length + attempts.length > 0 ? "Audit ready" : "Settings",
      icon: SettingsIcon,
    },
  ];

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
        <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {commandTiles.map(({ key, label, value, icon: Icon }) => {
            const selected = activePanel === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActivePanel(selected ? null : key)}
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
          <ActionButton
            icon={Repeat2}
            title="Recurring"
            onClick={() => setActivePanel("recurring")}
          />
        </ActionGroup>
      ) : null}

      {activePanel === "recurring" ? (
        <ProScheduleCard
          draft={scheduleDraft}
          rows={schedules.rows}
          walletName={name}
          defaultAsset={runtime.defaultPaymentAsset}
          onDraftChange={setScheduleDraft}
          onSave={saveSchedule}
          onRemove={schedules.remove}
        />
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

      {activePanel === "automation" ? (
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
      ) : null}

      {activePanel === "audit" ? (
        <ProAuditCard
          activityCount={activityRows.length}
          lastReceipt={lastReceipt}
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
          aria-label="Schedule name"
          value={draft.name}
          onChange={(event) =>
            onDraftChange({ ...draft, name: event.target.value })
          }
          placeholder="Vendor or team member"
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none placeholder:text-text-soft focus:border-accent/50"
        />
        <input
          aria-label="Schedule recipient"
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
            aria-label="Schedule amount"
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
            aria-label="Schedule category"
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
            aria-label="Schedule cadence"
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
          aria-label="Next payment date"
          value={draft.nextRun}
          onChange={(event) =>
            onDraftChange({ ...draft, nextRun: event.target.value })
          }
          className="min-h-11 rounded-soft border border-border-soft bg-canvas px-3 text-sm text-text-strong outline-none focus:border-accent/50"
        />
        <input
          aria-label="Schedule note"
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
