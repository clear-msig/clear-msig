"use client";

import { useEffect, useMemo, useState } from "react";

export type ProEscrowStatus = "active" | "disputed" | "returned" | "complete";
export type ProEscrowMilestoneStatus = "planned" | "released";

export interface ProEscrowFunder {
  id: string;
  name: string;
  address: string;
  asset: string;
  amount: string;
}

export interface ProEscrowMilestone {
  id: string;
  title: string;
  recipient: string;
  asset: string;
  amount: string;
  status: ProEscrowMilestoneStatus;
}

export interface ProEscrowProject {
  id: string;
  title: string;
  counterparty: string;
  status: ProEscrowStatus;
  funders: ProEscrowFunder[];
  milestones: ProEscrowMilestone[];
  createdAt: number;
  updatedAt?: number;
}

export interface ProEscrowReturnRow {
  recipient: string;
  amount: string;
}

const ESCROW_STORAGE_PREFIX = "clear.pro.escrows.v1:";
const BATCH_PREFILL_PREFIX = "clear.pro.batchPrefill.v1:";

export function useProEscrows(walletName: string) {
  const [rows, setRows] = useState<ProEscrowProject[]>([]);

  useEffect(() => {
    if (typeof window === "undefined" || !walletName.trim()) {
      setRows([]);
      return;
    }
    try {
      const raw = window.localStorage.getItem(escrowKey(walletName));
      if (!raw) {
        setRows([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setRows(Array.isArray(parsed) ? parsed.filter(isProEscrowProject) : []);
    } catch {
      setRows([]);
    }
  }, [walletName]);

  const actions = useMemo(
    () => ({
      add: (draft: Omit<ProEscrowProject, "id" | "createdAt" | "updatedAt">) => {
        const now = Date.now();
        const row: ProEscrowProject = {
          ...draft,
          id: randomId(),
          createdAt: now,
          updatedAt: now,
        };
        setRows((current) => {
          const next = [row, ...current].slice(0, 25);
          persistEscrows(walletName, next);
          return next;
        });
        return row;
      },
      update: (id: string, patch: Partial<ProEscrowProject>) => {
        setRows((current) => {
          const next = current.map((row) =>
            row.id === id ? { ...row, ...patch, updatedAt: Date.now() } : row,
          );
          persistEscrows(walletName, next);
          return next;
        });
      },
      remove: (id: string) => {
        setRows((current) => {
          const next = current.filter((row) => row.id !== id);
          persistEscrows(walletName, next);
          return next;
        });
      },
      markMilestoneReleased: (projectId: string, milestoneId: string) => {
        setRows((current) => {
          const next = current.map((row) => {
            if (row.id !== projectId) return row;
            return {
              ...row,
              milestones: row.milestones.map((milestone) =>
                milestone.id === milestoneId
                  ? { ...milestone, status: "released" as const }
                  : milestone,
              ),
              updatedAt: Date.now(),
            };
          });
          persistEscrows(walletName, next);
          return next;
        });
      },
    }),
    [walletName],
  );

  return { rows, ...actions };
}

export function buildProEscrowReturnRows(
  project: ProEscrowProject,
): ProEscrowReturnRow[] {
  const fundedSol = sumAmounts(
    project.funders.filter((row) => row.asset.toUpperCase() === "SOL"),
  );
  const releasedSol = sumAmounts(
    project.milestones.filter(
      (row) => row.asset.toUpperCase() === "SOL" && row.status === "released",
    ),
  );
  const remainingSol = Math.max(0, fundedSol - releasedSol);
  if (fundedSol <= 0 || remainingSol <= 0) return [];

  return project.funders
    .filter((row) => row.asset.toUpperCase() === "SOL")
    .map((row) => {
      const contribution = parsePositiveAmount(row.amount);
      const amount = (remainingSol * contribution) / fundedSol;
      return {
        recipient: row.address,
        amount: trimAmount(amount),
      };
    })
    .filter((row) => row.recipient.trim() && Number(row.amount) > 0);
}

export function saveProBatchPrefill(
  walletName: string,
  rows: ProEscrowReturnRow[],
): string {
  const id = randomId();
  if (typeof window === "undefined") return id;
  try {
    window.localStorage.setItem(
      batchPrefillKey(walletName, id),
      JSON.stringify(rows.slice(0, 50)),
    );
  } catch {
    /* best-effort handoff */
  }
  return id;
}

export function consumeProBatchPrefill(
  walletName: string,
  id: string,
): ProEscrowReturnRow[] {
  if (typeof window === "undefined" || !walletName.trim() || !id.trim()) {
    return [];
  }
  const key = batchPrefillKey(walletName, id);
  try {
    const raw = window.localStorage.getItem(key);
    window.localStorage.removeItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(isBatchPrefillRow)
      .map((row) => ({
        recipient: row.recipient.trim(),
        amount: row.amount.trim(),
      }));
  } catch {
    return [];
  }
}

export function escrowFundedAmount(project: ProEscrowProject, asset = "SOL") {
  return sumAmounts(
    project.funders.filter((row) => row.asset.toUpperCase() === asset),
  );
}

export function escrowReleasedAmount(project: ProEscrowProject, asset = "SOL") {
  return sumAmounts(
    project.milestones.filter(
      (row) => row.asset.toUpperCase() === asset && row.status === "released",
    ),
  );
}

function escrowKey(walletName: string): string {
  return `${ESCROW_STORAGE_PREFIX}${walletName}`;
}

function batchPrefillKey(walletName: string, id: string): string {
  return `${BATCH_PREFILL_PREFIX}${walletName}:${id}`;
}

function persistEscrows(walletName: string, next: ProEscrowProject[]): void {
  if (typeof window === "undefined" || !walletName.trim()) return;
  try {
    window.localStorage.setItem(escrowKey(walletName), JSON.stringify(next));
  } catch {
    /* local escrow records are best-effort */
  }
}

function isProEscrowProject(value: unknown): value is ProEscrowProject {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.counterparty === "string" &&
    (row.status === "active" ||
      row.status === "disputed" ||
      row.status === "returned" ||
      row.status === "complete") &&
    Array.isArray(row.funders) &&
    row.funders.every(isFunder) &&
    Array.isArray(row.milestones) &&
    row.milestones.every(isMilestone) &&
    typeof row.createdAt === "number" &&
    (row.updatedAt === undefined || typeof row.updatedAt === "number")
  );
}

function isFunder(value: unknown): value is ProEscrowFunder {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    typeof row.address === "string" &&
    typeof row.asset === "string" &&
    typeof row.amount === "string"
  );
}

function isMilestone(value: unknown): value is ProEscrowMilestone {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.title === "string" &&
    typeof row.recipient === "string" &&
    typeof row.asset === "string" &&
    typeof row.amount === "string" &&
    (row.status === "planned" || row.status === "released")
  );
}

function isBatchPrefillRow(value: unknown): value is ProEscrowReturnRow {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.recipient === "string" && typeof row.amount === "string";
}

function sumAmounts<T extends { amount: string }>(rows: T[]): number {
  return rows.reduce((sum, row) => sum + parsePositiveAmount(row.amount), 0);
}

function parsePositiveAmount(value: string): number {
  const amount = Number(value.trim());
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function trimAmount(value: number): string {
  const formatted = value.toLocaleString("en-US", {
    useGrouping: false,
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
  return formatted.includes(".")
    ? formatted.replace(/0+$/, "").replace(/\.$/, "")
    : formatted;
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
