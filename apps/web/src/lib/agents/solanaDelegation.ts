import { PublicKey } from "@solana/web3.js";
import type {
  AgentProfile,
  AgentVaultPolicy,
  TradingVenue,
} from "@/lib/agents/types";

const STORAGE_KEY = "clear.agents.solanaDelegation.v1";

export type AgentSolanaDelegationStatus =
  | "not_started"
  | "active"
  | "rotation_required"
  | "revoked";

export type AgentSolanaDelegationStepStatus = "ready" | "todo" | "blocked";

export interface AgentSolanaDelegationRecord {
  walletName: string;
  agentId: string;
  agentSignerPubkey: string;
  status: AgentSolanaDelegationStatus;
  allowedVenues: TradingVenue[];
  allowedMarkets: string[];
  maxNotionalUsd: string;
  maxLeverage: number;
  maxOpenPositions: number;
  expiresAt: number;
  policyHash?: string;
  approvedAt?: number;
  revokedAt?: number;
  rotationReason?: string;
  updatedAt: number;
  version: 1;
}

export interface AgentSolanaDelegationStep {
  id: "signer" | "scope" | "policy" | "expiry" | "lifecycle";
  label: string;
  status: AgentSolanaDelegationStepStatus;
  message: string;
}

export interface AgentSolanaDelegationSummary {
  status: "ready" | "needs_setup" | "blocked";
  headline: string;
  steps: AgentSolanaDelegationStep[];
}

export function getAgentSolanaDelegation(
  walletName: string,
  agentId: string,
): AgentSolanaDelegationRecord {
  return (
    listAgentSolanaDelegations(walletName).find((item) => item.agentId === agentId) ??
    emptyDelegation(walletName, agentId)
  );
}

export function listAgentSolanaDelegations(
  walletName: string,
): AgentSolanaDelegationRecord[] {
  return readAll().filter((item) => item.walletName === walletName);
}

export function saveAgentSolanaDelegation({
  walletName,
  agentId,
  agentSignerPubkey,
  policy,
  allowedVenues,
  allowedMarkets,
  maxNotionalUsd,
  maxLeverage,
  maxOpenPositions,
  expiresAt,
  now = Date.now(),
}: {
  walletName: string;
  agentId: string;
  agentSignerPubkey: string;
  policy: AgentVaultPolicy;
  allowedVenues?: TradingVenue[];
  allowedMarkets?: string[];
  maxNotionalUsd?: string;
  maxLeverage?: number;
  maxOpenPositions?: number;
  expiresAt?: number;
  now?: number;
}): AgentSolanaDelegationRecord {
  const signer = agentSignerPubkey.trim();
  if (!isSolanaPubkey(signer)) {
    throw new Error("Enter a valid Solana agent signer public key.");
  }
  const normalizedMarkets = uniqueStrings(
    (allowedMarkets?.length ? allowedMarkets : policy.allowedMarkets).map((market) =>
      market.trim().toUpperCase(),
    ),
  );
  const normalizedVenues = uniqueVenues(
    allowedVenues?.length ? allowedVenues : policy.allowedVenues,
  );
  const notional = normalizePositiveUsd(maxNotionalUsd ?? policy.maxNotionalUsd);
  const leverage = normalizePositiveNumber(maxLeverage ?? policy.maxLeverage);
  const openPositions = normalizePositiveNumber(
    maxOpenPositions ?? policy.maxOpenPositionsPerAgent,
  );
  const expiry = Number(expiresAt ?? now + Math.max(1, policy.maxSessionHours) * 60 * 60_000);
  if (normalizedMarkets.length === 0) throw new Error("Choose at least one market.");
  if (normalizedVenues.length === 0) throw new Error("Choose at least one venue.");
  if (!notional) throw new Error("Enter a valid max notional.");
  if (!leverage) throw new Error("Enter a valid max leverage.");
  if (!openPositions) throw new Error("Enter a valid open-position limit.");
  if (!Number.isFinite(expiry) || expiry <= now) {
    throw new Error("Choose a future expiry for this Solana delegation.");
  }

  const previous = getAgentSolanaDelegation(walletName, agentId);
  const signerChanged = previous.agentSignerPubkey !== signer;
  const record: AgentSolanaDelegationRecord = {
    walletName,
    agentId,
    agentSignerPubkey: signer,
    status: signerChanged ? "active" : activeStatus(previous.status),
    allowedVenues: normalizedVenues,
    allowedMarkets: normalizedMarkets,
    maxNotionalUsd: notional,
    maxLeverage: leverage,
    maxOpenPositions: openPositions,
    expiresAt: expiry,
    policyHash: policy.policyHash,
    approvedAt: signerChanged ? now : previous.approvedAt || now,
    revokedAt: undefined,
    rotationReason: signerChanged ? undefined : previous.rotationReason,
    updatedAt: now,
    version: 1,
  };
  writeOne(record);
  return record;
}

export function updateAgentSolanaDelegationStatus({
  walletName,
  agentId,
  status,
  reason,
  now = Date.now(),
}: {
  walletName: string;
  agentId: string;
  status: Exclude<AgentSolanaDelegationStatus, "not_started">;
  reason?: string;
  now?: number;
}): AgentSolanaDelegationRecord {
  const existing = getAgentSolanaDelegation(walletName, agentId);
  if (!existing.agentSignerPubkey) {
    throw new Error("Add a Solana agent signer before changing delegation status.");
  }
  const record: AgentSolanaDelegationRecord = {
    ...existing,
    status,
    approvedAt: status === "active" ? existing.approvedAt ?? now : existing.approvedAt,
    revokedAt: status === "revoked" ? now : undefined,
    rotationReason:
      status === "rotation_required"
        ? clean(reason) ?? "Rotate this Solana agent signer before using it again."
        : undefined,
    updatedAt: now,
  };
  writeOne(record);
  return record;
}

export function buildAgentSolanaDelegationSummary({
  delegation,
  policy,
  agent,
  now = Date.now(),
}: {
  delegation: AgentSolanaDelegationRecord;
  policy: AgentVaultPolicy;
  agent?: AgentProfile | null;
  now?: number;
}): AgentSolanaDelegationSummary {
  const expired = delegation.expiresAt > 0 && delegation.expiresAt <= now;
  const policyCurrent =
    Boolean(policy.policyHash) && delegation.policyHash === policy.policyHash;
  const signerReady = isSolanaPubkey(delegation.agentSignerPubkey);
  const scopeReady =
    delegation.allowedMarkets.length > 0 &&
    delegation.allowedVenues.length > 0 &&
    Number(delegation.maxNotionalUsd) > 0 &&
    delegation.maxLeverage > 0 &&
    delegation.maxOpenPositions > 0;
  const lifecycleReady = delegation.status === "active" && !expired;
  const steps: AgentSolanaDelegationStep[] = [
    {
      id: "signer",
      label: "Agent signer",
      status: signerReady ? "ready" : "todo",
      message: signerReady
        ? `${agent?.name ?? "Agent"} signer ${shortKey(delegation.agentSignerPubkey)} is recorded.`
        : "Add the Solana public key that identifies the agent signer.",
    },
    {
      id: "scope",
      label: "Scoped permissions",
      status: scopeReady ? "ready" : signerReady ? "todo" : "blocked",
      message: scopeReady
        ? `${delegation.allowedVenues.join(", ")} · ${delegation.allowedMarkets.join(", ")} · max $${delegation.maxNotionalUsd} at ${delegation.maxLeverage}x.`
        : "Set allowed venues, markets, max size, leverage, and open-position limits.",
    },
    {
      id: "policy",
      label: "Policy hash",
      status: policyCurrent ? "ready" : delegation.policyHash ? "blocked" : "todo",
      message: policyCurrent
        ? `Bound to current policy ${delegation.policyHash?.slice(0, 12)}...`
        : delegation.policyHash
          ? "The vault policy changed. Re-approve this delegation before trading."
          : "Save the vault policy so the delegation can bind to a policy hash.",
    },
    {
      id: "expiry",
      label: "Expiry",
      status: !delegation.expiresAt
        ? "todo"
        : expired
          ? "blocked"
          : "ready",
      message: delegation.expiresAt
        ? expired
          ? "This delegation expired. Create a new one before trading."
          : `Expires ${new Date(delegation.expiresAt).toLocaleString()}.`
        : "Set a future expiry.",
    },
    {
      id: "lifecycle",
      label: "Lifecycle",
      status: lifecycleReady
        ? "ready"
        : delegation.status === "revoked" || delegation.status === "rotation_required" || expired
          ? "blocked"
          : "todo",
      message:
        delegation.status === "active" && !expired
          ? "Delegation is active."
          : delegation.status === "revoked"
            ? "Delegation is revoked. The signer should not be trusted."
            : delegation.status === "rotation_required"
              ? delegation.rotationReason ??
                "Signer rotation is required before trading."
              : "Approve the delegation before trading.",
    },
  ];
  const blocked = steps.some((step) => step.status === "blocked");
  const ready = steps.every((step) => step.status === "ready");
  return {
    status: ready ? "ready" : blocked ? "blocked" : "needs_setup",
    headline: ready
      ? "Solana agent delegation is ready"
      : blocked
        ? "Solana delegation needs review"
        : "Finish Solana delegation setup",
    steps,
  };
}

function emptyDelegation(
  walletName: string,
  agentId: string,
): AgentSolanaDelegationRecord {
  return {
    walletName,
    agentId,
    agentSignerPubkey: "",
    status: "not_started",
    allowedVenues: [],
    allowedMarkets: [],
    maxNotionalUsd: "",
    maxLeverage: 0,
    maxOpenPositions: 0,
    expiresAt: 0,
    updatedAt: 0,
    version: 1,
  };
}

function readAll(): AgentSolanaDelegationRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeRecord).filter((item): item is AgentSolanaDelegationRecord => Boolean(item))
      : [];
  } catch {
    return [];
  }
}

function writeOne(record: AgentSolanaDelegationRecord): void {
  if (typeof window === "undefined") return;
  const next = [
    record,
    ...readAll().filter(
      (item) =>
        item.walletName !== record.walletName || item.agentId !== record.agentId,
    ),
  ].slice(0, 100);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function normalizeRecord(input: unknown): AgentSolanaDelegationRecord | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (
    typeof record.walletName !== "string" ||
    typeof record.agentId !== "string" ||
    record.version !== 1
  ) {
    return null;
  }
  return {
    walletName: record.walletName,
    agentId: record.agentId,
    agentSignerPubkey: stringValue(record.agentSignerPubkey),
    status: statusValue(record.status, record.agentSignerPubkey),
    allowedVenues: uniqueVenues(
      Array.isArray(record.allowedVenues) ? record.allowedVenues : [],
    ),
    allowedMarkets: uniqueStrings(
      Array.isArray(record.allowedMarkets)
        ? record.allowedMarkets.map((item) => String(item).toUpperCase())
        : [],
    ),
    maxNotionalUsd: stringValue(record.maxNotionalUsd),
    maxLeverage: numberValue(record.maxLeverage),
    maxOpenPositions: numberValue(record.maxOpenPositions),
    expiresAt: numberValue(record.expiresAt),
    policyHash: stringValue(record.policyHash) || undefined,
    approvedAt: optionalNumber(record.approvedAt),
    revokedAt: optionalNumber(record.revokedAt),
    rotationReason: clean(stringValue(record.rotationReason)),
    updatedAt: numberValue(record.updatedAt),
    version: 1,
  };
}

function isSolanaPubkey(value: string): boolean {
  if (!value || value.length < 32 || value.length > 44) return false;
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}

function activeStatus(status: AgentSolanaDelegationStatus): AgentSolanaDelegationStatus {
  return status === "revoked" ? "active" : status;
}

function statusValue(
  value: unknown,
  signer: unknown,
): AgentSolanaDelegationStatus {
  if (
    value === "not_started" ||
    value === "active" ||
    value === "rotation_required" ||
    value === "revoked"
  ) {
    return value;
  }
  return typeof signer === "string" && signer.trim() ? "active" : "not_started";
}

function normalizePositiveUsd(value: string): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(parsed) : "";
}

function normalizePositiveNumber(value: number): number {
  return Number.isFinite(value) && value > 0 ? Number(value) : 0;
}

function uniqueVenues(values: unknown[]): TradingVenue[] {
  const allowed: TradingVenue[] = ["mock_perps", "hyperliquid_testnet", "bulktrade_mock"];
  return Array.from(
    new Set(
      values.filter((value): value is TradingVenue =>
        allowed.includes(value as TradingVenue),
      ),
    ),
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function shortKey(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}
