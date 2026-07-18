"use client";

import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/api/client";
import type { TxAttempt } from "@/lib/retail/txLog";

export type ProScheduleCategory = "vendor" | "payroll";
export type ProScheduleCadence = "Weekly" | "Monthly";

export interface ProSchedule {
  id: string;
  name: string;
  address?: string;
  category: ProScheduleCategory;
  amount: string;
  asset: string;
  cadence: ProScheduleCadence;
  nextRun: string;
  note?: string;
  createdAt: number;
  updatedAt?: number;
  proposalAddress?: string;
  intentAddress?: string;
  intervalSeconds?: number;
  firstExecutionAt?: number;
  paymentCount?: number;
  mint?: string;
  sourceToken?: string;
  destinationToken?: string;
  recipientOwner?: string;
  policyVersion?: "CSP1" | "CSP2";
}

export interface ProTreasuryRuntime {
  environmentLabel: string;
  defaultPaymentAsset: string;
  batchCsvColumns: string[];
  importSources: string[];
  accountingTargets: string[];
  statusUrl: string;
  auditUrl: string;
  securityUrl: string;
  recoveryUrl: string;
}

export interface ProAccountingExportInput {
  walletName: string;
  attempts: TxAttempt[];
  schedules: ProSchedule[];
}

const SCHEDULE_STORAGE_PREFIX = "clear.pro.schedules.v1:";
const PRO_SYNC_TIMEOUT_MS = 8_000;

export function getProTreasuryRuntime(): ProTreasuryRuntime {
  return {
    environmentLabel:
      process.env.NEXT_PUBLIC_CLEARSIG_ENVIRONMENT_LABEL ?? "Devnet",
    defaultPaymentAsset:
      process.env.NEXT_PUBLIC_CLEARSIG_PRO_DEFAULT_PAYMENT_ASSET ?? "SOL",
    batchCsvColumns: envList(
      process.env.NEXT_PUBLIC_CLEARSIG_PRO_BATCH_CSV_COLUMNS,
      ["name", "address", "asset", "amount", "note"],
    ),
    importSources: envList(
      process.env.NEXT_PUBLIC_CLEARSIG_PRO_IMPORT_SOURCES,
      ["Squads", "Safe", "CSV"],
    ),
    accountingTargets: envList(
      process.env.NEXT_PUBLIC_CLEARSIG_PRO_ACCOUNTING_TARGETS,
      ["CSV", "QuickBooks", "Xero"],
    ),
    statusUrl: envUrl(
      process.env.NEXT_PUBLIC_CLEARSIG_STATUS_URL,
      "/security",
    ),
    auditUrl: envUrl(
      process.env.NEXT_PUBLIC_CLEARSIG_AUDIT_URL,
      "/app/security-architecture",
    ),
    securityUrl: envUrl(
      process.env.NEXT_PUBLIC_CLEARSIG_SECURITY_URL,
      "/security",
    ),
    recoveryUrl: envUrl(
      process.env.NEXT_PUBLIC_CLEARSIG_RECOVERY_POLICY_URL,
      "/app/secure",
    ),
  };
}

function envList(value: string | undefined, fallback: string[]): string[] {
  const list = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return list.length > 0 ? list : fallback;
}

function envUrl(value: string | undefined, fallback: string): string {
  const next = value?.trim();
  if (!next) return fallback;
  if (next.startsWith("/") || /^https?:\/\//i.test(next)) return next;
  return fallback;
}

function proSchedulesKey(walletName: string): string {
  return `${SCHEDULE_STORAGE_PREFIX}${walletName}`;
}

function isProSchedule(value: unknown): value is ProSchedule {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    (row.address === undefined || typeof row.address === "string") &&
    (row.category === "vendor" || row.category === "payroll") &&
    typeof row.amount === "string" &&
    typeof row.asset === "string" &&
    (row.cadence === "Weekly" || row.cadence === "Monthly") &&
    typeof row.nextRun === "string" &&
    (row.note === undefined || typeof row.note === "string") &&
    typeof row.createdAt === "number" &&
    (row.updatedAt === undefined || typeof row.updatedAt === "number")
    && (row.proposalAddress === undefined || typeof row.proposalAddress === "string")
    && (row.intentAddress === undefined || typeof row.intentAddress === "string")
    && (row.intervalSeconds === undefined || typeof row.intervalSeconds === "number")
    && (row.firstExecutionAt === undefined || typeof row.firstExecutionAt === "number")
    && (row.paymentCount === undefined || typeof row.paymentCount === "number")
    && (row.mint === undefined || typeof row.mint === "string")
    && (row.sourceToken === undefined || typeof row.sourceToken === "string")
    && (row.destinationToken === undefined || typeof row.destinationToken === "string")
    && (row.recipientOwner === undefined || typeof row.recipientOwner === "string")
  );
}

export function useProSchedules(walletName: string) {
  const [rows, setRows] = useState<ProSchedule[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;
    try {
      const raw = window.localStorage.getItem(proSchedulesKey(walletName));
      if (!raw) {
        setRows([]);
      } else {
        const parsed = JSON.parse(raw);
        setRows(Array.isArray(parsed) ? parsed.filter(isProSchedule) : []);
      }
    } catch {
      setRows([]);
    }

    void listProSchedules(walletName)
      .then((remoteRows) => {
        if (cancelled) return;
        setRows((current) => {
          const remoteIds = new Set(remoteRows.map((row) => row.id));
          for (const row of current) {
            if (!remoteIds.has(row.id)) {
              void upsertProSchedule(walletName, row);
            }
          }
          const merged = mergeSchedules(current, remoteRows);
          persistSchedules(walletName, merged);
          return merged;
        });
      })
      .catch(() => {
        // Backend persistence is progressive. Local schedules remain
        // usable before the backend has the Pro routes deployed.
      });

    return () => {
      cancelled = true;
    };
  }, [walletName]);

  const saveRows = (next: ProSchedule[]) => {
    setRows(next);
    persistSchedules(walletName, next);
  };

  return {
    rows,
    add: (draft: Omit<ProSchedule, "id" | "createdAt">) => {
      const now = Date.now();
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      const row = { ...draft, id, createdAt: now, updatedAt: now };
      saveRows([row, ...rows].slice(0, 50));
      void upsertProSchedule(walletName, row);
      void appendProAuditEvent({
        walletName,
        eventType: "schedule_saved",
        title: `Saved ${row.name}`,
        reference: row.id,
        metadata: {
          amount: row.amount,
          asset: row.asset,
          cadence: row.cadence,
          category: row.category,
          nextRun: row.nextRun,
        },
      });
    },
    upsert: (row: ProSchedule) => {
      const next = [row, ...rows.filter((item) => item.id !== row.id)].slice(0, 50);
      saveRows(next);
      void upsertProSchedule(walletName, row);
    },
    remove: (id: string) => {
      const row = rows.find((item) => item.id === id);
      saveRows(rows.filter((item) => item.id !== id));
      void deleteProSchedule(walletName, id);
      void appendProAuditEvent({
        walletName,
        eventType: "schedule_removed",
        title: row ? `Removed ${row.name}` : "Removed schedule",
        reference: id,
      });
    },
  };
}

function persistSchedules(walletName: string, next: ProSchedule[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      proSchedulesKey(walletName),
      JSON.stringify(next),
    );
  } catch {
    /* local schedule reminders are best-effort */
  }
}

function mergeSchedules(
  localRows: ProSchedule[],
  remoteRows: ProSchedule[],
): ProSchedule[] {
  const byId = new Map<string, ProSchedule>();
  for (const row of [...localRows, ...remoteRows]) {
    const current = byId.get(row.id);
    if (!current) {
      byId.set(row.id, row);
      continue;
    }
    const currentStamp = current.updatedAt ?? current.createdAt;
    const rowStamp = row.updatedAt ?? row.createdAt;
    if (rowStamp >= currentStamp) byId.set(row.id, row);
  }
  return [...byId.values()]
    .sort((a, b) => a.nextRun.localeCompare(b.nextRun) || a.name.localeCompare(b.name))
    .slice(0, 50);
}

interface ProBackendEnvelope<T> {
  ok: boolean;
  data: T;
}

interface ProSchedulesData {
  walletName: string;
  schedules: ProSchedule[];
}

interface ProAuditEventInput {
  walletName: string;
  eventType: string;
  title: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

async function listProSchedules(walletName: string): Promise<ProSchedule[]> {
  if (!walletName.trim()) return [];
  const response = await apiRequest<ProBackendEnvelope<ProSchedulesData>>(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/schedules`,
    "GET",
    undefined,
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
  return response.data.schedules.filter(isProSchedule);
}

async function upsertProSchedule(
  walletName: string,
  row: ProSchedule,
): Promise<void> {
  if (!walletName.trim()) return;
  await apiRequest(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/schedules`,
    "POST",
    row,
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
}

async function deleteProSchedule(walletName: string, id: string): Promise<void> {
  if (!walletName.trim() || !id.trim()) return;
  await apiRequest(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/schedules/delete`,
    "POST",
    { id },
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
}

async function appendProAuditEvent(input: ProAuditEventInput): Promise<void> {
  if (!input.walletName.trim() || !input.title.trim()) return;
  await apiRequest(
    "/v1/pro/audit-events",
    "POST",
    {
      ...input,
      metadata: input.metadata ?? {},
    },
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
}

export function buildProAccountingCsv(input: ProAccountingExportInput): string {
  const rows: string[][] = [
    [
      "record_type",
      "wallet",
      "date",
      "name",
      "asset",
      "amount",
      "status",
      "reference",
      "note",
      "address",
      "cadence",
    ],
  ];

  for (const attempt of input.attempts) {
    rows.push([
      "payment_attempt",
      input.walletName,
      new Date(attempt.ts).toISOString(),
      attempt.recipientShort ?? "",
      attempt.ticker ?? "",
      attempt.amountDisplay ?? "",
      attempt.status,
      attempt.txId ?? attempt.id,
      attempt.errorBrief ?? "",
      attempt.recipientFull ?? "",
      "",
    ]);
  }

  for (const schedule of input.schedules) {
    rows.push([
      "recurring_schedule",
      input.walletName,
      schedule.nextRun,
      schedule.name,
      schedule.asset,
      schedule.amount,
      schedule.category,
      schedule.id,
      schedule.note ?? schedule.cadence,
      schedule.address ?? "",
      schedule.cadence,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

export function downloadProAccountingCsv(
  filename: string,
  csv: string,
): void {
  if (typeof window === "undefined") return;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}
