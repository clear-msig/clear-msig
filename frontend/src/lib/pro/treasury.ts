"use client";

import { useEffect, useState } from "react";

export type ProScheduleCategory = "vendor" | "payroll";
export type ProScheduleCadence = "Weekly" | "Monthly";

export interface ProSchedule {
  id: string;
  name: string;
  category: ProScheduleCategory;
  amount: string;
  asset: string;
  cadence: ProScheduleCadence;
  nextRun: string;
  createdAt: number;
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

const SCHEDULE_STORAGE_PREFIX = "clear.pro.schedules.v1:";

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
    (row.category === "vendor" || row.category === "payroll") &&
    typeof row.amount === "string" &&
    typeof row.asset === "string" &&
    (row.cadence === "Weekly" || row.cadence === "Monthly") &&
    typeof row.nextRun === "string" &&
    typeof row.createdAt === "number"
  );
}

export function useProSchedules(walletName: string) {
  const [rows, setRows] = useState<ProSchedule[]>([]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(proSchedulesKey(walletName));
      if (!raw) {
        setRows([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setRows(Array.isArray(parsed) ? parsed.filter(isProSchedule) : []);
    } catch {
      setRows([]);
    }
  }, [walletName]);

  const saveRows = (next: ProSchedule[]) => {
    setRows(next);
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        proSchedulesKey(walletName),
        JSON.stringify(next),
      );
    } catch {
      /* local schedule reminders are best-effort */
    }
  };

  return {
    rows,
    add: (draft: Omit<ProSchedule, "id" | "createdAt">) => {
      const id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      saveRows([{ ...draft, id, createdAt: Date.now() }, ...rows].slice(0, 50));
    },
    remove: (id: string) => saveRows(rows.filter((row) => row.id !== id)),
  };
}
