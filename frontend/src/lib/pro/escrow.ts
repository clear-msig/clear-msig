"use client";

import { useEffect, useMemo, useState } from "react";
import { apiRequest } from "@/lib/api/client";
import type {
  ClearSignEnvelope,
  EscrowReturnPayload,
  MilestonePayload,
} from "@/lib/clearsign";
import { sha256, toHex } from "@/lib/msig/hash";

export type ProEscrowStatus = "active" | "disputed" | "returned" | "complete";
export type ProEscrowMilestoneStatus = "planned" | "released";

export interface ProEscrowFunder {
  id: string;
  name: string;
  entity?: string;
  address: string;
  asset: string;
  amount: string;
}

export interface ProEscrowMilestone {
  id: string;
  title: string;
  recipient: string;
  recipientEntity?: string;
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
  policy?: ProEscrowPolicy;
  createdAt: number;
  updatedAt?: number;
}

export interface ProEscrowReturnRow {
  recipient: string;
  amount: string;
}

export interface ProEscrowReturnPreviewRow extends ProEscrowReturnRow {
  funderId: string;
  funderName: string;
  funderEntity?: string;
  asset: string;
  rawAmount: string;
}

export interface ProEscrowReturnPreview {
  walletName: string;
  escrowId: string;
  escrowTitle: string;
  policy: ProEscrowPolicy;
  totalReturn: string;
  rawTotalReturn: string;
  returns: ProEscrowReturnPreviewRow[];
}

export interface ProEscrowReleasePreview {
  walletName: string;
  escrowId: string;
  escrowTitle: string;
  milestoneId: string;
  milestoneTitle: string;
  recipient: string;
  recipientEntity?: string;
  asset: string;
  amount: string;
  rawAmount: string;
  policy: ProEscrowPolicy;
}

export interface ProEscrowClearSignOptions {
  walletName: string;
  walletId?: string;
  actionId?: string;
  nonce?: string;
  expiresAt?: number;
}

export interface ProEscrowPolicy {
  version: 1;
  mode: "milestone_escrow";
  releaseRequires: "wallet_approval";
  unwindRequires: "wallet_approval";
  returnBasis: "recorded_funder_contribution";
  assetMode: "per_asset";
  enforcement: "approval_workflow" | "onchain_policy_pending";
  commitment: string;
}

const ESCROW_STORAGE_PREFIX = "clear.pro.escrows.v1:";
const BATCH_PREFILL_PREFIX = "clear.pro.batchPrefill.v1:";
const PRO_SYNC_TIMEOUT_MS = 8_000;
const enc = new TextEncoder();

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
      setRows(
        Array.isArray(parsed)
          ? parsed.filter(isProEscrowProject).map(bindProEscrowPolicy)
          : [],
      );
    } catch {
      setRows([]);
    }

    let cancelled = false;
    void listProEscrows(walletName)
      .then((remoteRows) => {
        if (cancelled) return;
        setRows((current) => {
          const remoteIds = new Set(remoteRows.map((row) => row.id));
          for (const row of current) {
            if (!remoteIds.has(row.id)) {
              void upsertProEscrow(walletName, row);
            }
          }
          const merged = mergeEscrows(current, remoteRows);
          persistEscrows(walletName, merged);
          return merged;
        });
      })
      .catch(() => {
        // Render persistence is progressive. Local escrow records still
        // work before the backend routes are deployed.
      });

    return () => {
      cancelled = true;
    };
  }, [walletName]);

  const actions = useMemo(
    () => ({
      add: (draft: Omit<ProEscrowProject, "id" | "createdAt" | "updatedAt">) => {
        const now = Date.now();
        const row = bindProEscrowPolicy({
          ...draft,
          id: randomId(),
          createdAt: now,
          updatedAt: now,
        });
        setRows((current) => {
          const next = [row, ...current].slice(0, 25);
          persistEscrows(walletName, next);
          return next;
        });
        void upsertProEscrow(walletName, row);
        void appendProEscrowAuditEvent({
          walletName,
          eventType: "escrow_created",
          title: `Created escrow: ${row.title}`,
          reference: row.id,
          metadata: {
            policyCommitment: row.policy?.commitment,
            counterparty: row.counterparty,
          },
        });
        return row;
      },
      update: (id: string, patch: Partial<ProEscrowProject>) => {
        setRows((current) => {
          const existing = current.find((row) => row.id === id);
          if (!existing) return current;
          const updated = bindProEscrowPolicy({
            ...existing,
            ...patch,
            updatedAt: Date.now(),
          });
          const next = current.map((row) => (row.id === id ? updated : row));
          persistEscrows(walletName, next);
          void upsertProEscrow(walletName, updated);
          void appendProEscrowAuditEvent({
            walletName,
            eventType: "escrow_updated",
            title: `Updated escrow: ${updated.title}`,
            reference: updated.id,
            metadata: {
              policyCommitment: updated.policy?.commitment,
            },
          });
          return next;
        });
      },
      remove: (id: string) => {
        setRows((current) => {
          const removed = current.find((row) => row.id === id) ?? null;
          const next = current.filter((row) => row.id !== id);
          persistEscrows(walletName, next);
          void deleteProEscrow(walletName, id);
          void appendProEscrowAuditEvent({
            walletName,
            eventType: "escrow_removed",
            title: removed ? `Removed escrow: ${removed.title}` : "Removed escrow",
            reference: id,
          });
          return next;
        });
      },
      markMilestoneReleased: (projectId: string, milestoneId: string) => {
        setRows((current) => {
          const existing = current.find((row) => row.id === projectId);
          if (!existing) return current;
          const updated: ProEscrowProject = {
            ...existing,
            milestones: existing.milestones.map((milestone) =>
              milestone.id === milestoneId
                ? { ...milestone, status: "released" as const }
                : milestone,
            ),
            updatedAt: Date.now(),
          };
          const next = current.map((row) =>
            row.id === projectId ? updated : row,
          );
          persistEscrows(walletName, next);
          void upsertProEscrow(walletName, updated);
          void appendProEscrowAuditEvent({
            walletName,
            eventType: "escrow_milestone_released",
            title: `Marked milestone released: ${updated.title}`,
            reference: projectId,
            metadata: {
              milestoneId,
              policyCommitment: updated.policy?.commitment,
            },
          });
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

export async function previewProEscrowReturn(
  walletName: string,
  project: ProEscrowProject,
): Promise<ProEscrowReturnPreview> {
  if (!walletName.trim() || !project.id.trim()) {
    throw new Error("Escrow is not ready.");
  }
  const response = await apiRequest<ProBackendEnvelope<ProEscrowReturnPreview>>(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/escrows/return-preview`,
    "POST",
    { id: project.id },
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
  return response.data;
}

export async function previewProEscrowRelease(
  walletName: string,
  project: ProEscrowProject,
  milestone: ProEscrowMilestone,
): Promise<ProEscrowReleasePreview> {
  if (!walletName.trim() || !project.id.trim() || !milestone.id.trim()) {
    throw new Error("Milestone is not ready.");
  }
  const response = await apiRequest<ProBackendEnvelope<ProEscrowReleasePreview>>(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/escrows/release-preview`,
    "POST",
    { id: project.id, milestoneId: milestone.id },
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
  return response.data;
}

export function buildProEscrowPolicyCommitment(
  project: Pick<
    ProEscrowProject,
    "title" | "counterparty" | "funders" | "milestones"
  >,
): string {
  return stableHash({
    kind: "clearsig.pro.escrow-policy",
    version: 1,
    title: normalizeText(project.title),
    counterparty: normalizeText(project.counterparty),
    releaseRequires: "wallet_approval",
    unwindRequires: "wallet_approval",
    returnBasis: "recorded_funder_contribution",
    assetMode: "per_asset",
    funders: project.funders.map((row) => ({
      name: normalizeText(row.name),
      entity: normalizeText(row.entity ?? ""),
      address: normalizeText(row.address),
      asset: normalizeAsset(row.asset),
      amount: normalizeDecimalText(row.amount),
    })),
    milestones: project.milestones.map((row) => ({
      title: normalizeText(row.title),
      recipient: normalizeText(row.recipient),
      recipientEntity: normalizeText(row.recipientEntity ?? ""),
      asset: normalizeAsset(row.asset),
      amount: normalizeDecimalText(row.amount),
    })),
  });
}

export function bindProEscrowPolicy(
  project: ProEscrowProject,
): ProEscrowProject {
  const commitment = buildProEscrowPolicyCommitment(project);
  return {
    ...project,
    policy: {
      version: 1,
      mode: "milestone_escrow",
      releaseRequires: "wallet_approval",
      unwindRequires: "wallet_approval",
      returnBasis: "recorded_funder_contribution",
      assetMode: "per_asset",
      enforcement: project.policy?.enforcement ?? "approval_workflow",
      commitment,
    },
  };
}

export async function recordProEscrowUnwindPrepared(input: {
  walletName: string;
  project: ProEscrowProject;
  rows: ProEscrowReturnRow[];
}): Promise<void> {
  await appendProEscrowAuditEvent({
    walletName: input.walletName,
    eventType: "escrow_unwind_prepared",
    title: `Prepared escrow return: ${input.project.title}`,
    reference: input.project.id,
    metadata: {
      rows: input.rows.length,
      policyCommitment: input.project.policy?.commitment,
    },
  });
}

export function buildProEscrowReleaseEnvelope(input: {
  walletName: string;
  walletId?: string;
  project: ProEscrowProject;
  milestone: ProEscrowMilestone;
  actionId?: string;
  nonce?: string;
  expiresAt?: number;
}): ClearSignEnvelope<MilestonePayload> {
  const project = bindProEscrowPolicy(input.project);
  return {
    ...clearSignMeta(input),
    kind: "release_milestone",
    policyCommitment: project.policy?.commitment ?? buildProEscrowPolicyCommitment(project),
    payload: {
      escrowId: project.id,
      escrowTitle: project.title,
      milestoneId: input.milestone.id,
      milestoneTitle: input.milestone.title,
      recipient: input.milestone.recipient,
      recipientEncoding: "solana_pubkey",
      amount: input.milestone.amount,
      asset: input.milestone.asset,
    },
  };
}

export function buildProEscrowReturnEnvelope(input: {
  walletName: string;
  walletId?: string;
  project: ProEscrowProject;
  rows: ProEscrowReturnRow[];
  actionId?: string;
  nonce?: string;
  expiresAt?: number;
}): ClearSignEnvelope<EscrowReturnPayload> {
  const project = bindProEscrowPolicy(input.project);
  const asset =
    project.funders.find((row) => row.asset.trim())?.asset ??
    project.milestones.find((row) => row.asset.trim())?.asset ??
    "SOL";
  return {
    ...clearSignMeta(input),
    kind: "return_escrow_funds",
    policyCommitment: project.policy?.commitment ?? buildProEscrowPolicyCommitment(project),
    payload: {
      escrowId: project.id,
      escrowTitle: project.title,
      returns: input.rows.map((row) => ({
        recipient: row.recipient,
        recipientEncoding: "solana_pubkey",
        amount: row.amount,
        asset,
      })),
    },
  };
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

function clearSignMeta(input: ProEscrowClearSignOptions) {
  return {
    version: 3 as const,
    walletName: input.walletName.trim(),
    walletId: input.walletId?.trim(),
    actionId: input.actionId?.trim() || randomId(),
    nonce: input.nonce?.trim() || randomId(),
    expiresAt:
      input.expiresAt ?? Math.floor(Date.now() / 1000) + 30 * 60,
  };
}

function persistEscrows(walletName: string, next: ProEscrowProject[]): void {
  if (typeof window === "undefined" || !walletName.trim()) return;
  try {
    window.localStorage.setItem(escrowKey(walletName), JSON.stringify(next));
  } catch {
    /* local escrow records are best-effort */
  }
}

function mergeEscrows(
  localRows: ProEscrowProject[],
  remoteRows: ProEscrowProject[],
): ProEscrowProject[] {
  const byId = new Map<string, ProEscrowProject>();
  for (const row of [...localRows, ...remoteRows].map(bindProEscrowPolicy)) {
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
    .sort(
      (a, b) =>
        (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, 25);
}

interface ProBackendEnvelope<T> {
  ok: boolean;
  data: T;
}

interface ProEscrowsData {
  walletName: string;
  escrows: ProEscrowProject[];
}

interface ProAuditEventInput {
  walletName: string;
  eventType: string;
  title: string;
  reference?: string;
  metadata?: Record<string, unknown>;
}

async function listProEscrows(walletName: string): Promise<ProEscrowProject[]> {
  if (!walletName.trim()) return [];
  const response = await apiRequest<ProBackendEnvelope<ProEscrowsData>>(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/escrows`,
    "GET",
    undefined,
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
  return response.data.escrows.filter(isProEscrowProject).map(bindProEscrowPolicy);
}

async function upsertProEscrow(
  walletName: string,
  row: ProEscrowProject,
): Promise<void> {
  if (!walletName.trim()) return;
  await apiRequest(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/escrows`,
    "POST",
    bindProEscrowPolicy(row),
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
}

async function deleteProEscrow(walletName: string, id: string): Promise<void> {
  if (!walletName.trim() || !id.trim()) return;
  await apiRequest(
    `/v1/pro/wallets/${encodeURIComponent(walletName)}/escrows/delete`,
    "POST",
    { id },
    { timeoutMs: PRO_SYNC_TIMEOUT_MS },
  );
}

async function appendProEscrowAuditEvent(
  input: ProAuditEventInput,
): Promise<void> {
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
    (row.policy === undefined || isProEscrowPolicy(row.policy)) &&
    typeof row.createdAt === "number" &&
    (row.updatedAt === undefined || typeof row.updatedAt === "number")
  );
}

function isProEscrowPolicy(value: unknown): value is ProEscrowPolicy {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    row.version === 1 &&
    row.mode === "milestone_escrow" &&
    row.releaseRequires === "wallet_approval" &&
    row.unwindRequires === "wallet_approval" &&
    row.returnBasis === "recorded_funder_contribution" &&
    row.assetMode === "per_asset" &&
    (row.enforcement === "approval_workflow" ||
      row.enforcement === "onchain_policy_pending") &&
    typeof row.commitment === "string"
  );
}

function isFunder(value: unknown): value is ProEscrowFunder {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.name === "string" &&
    (row.entity === undefined || typeof row.entity === "string") &&
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
    (row.recipientEntity === undefined ||
      typeof row.recipientEntity === "string") &&
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

function stableHash(value: unknown): string {
  return toHex(sha256(enc.encode(stableStringify(value))));
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function normalizeText(value: string): string {
  return value.trim();
}

function normalizeAsset(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeDecimalText(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}
