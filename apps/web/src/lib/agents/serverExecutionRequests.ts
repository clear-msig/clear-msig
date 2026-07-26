import { createHash, randomUUID } from "crypto";
import type {
  AgentServerExecutionReadiness,
  AgentServerExecutionRequest,
} from "@/lib/agents/serverExecutionAdapters";
import type { HyperliquidTestnetOrderArtifact } from "@/lib/agents/serverHyperliquidTestnet";
import type { HyperliquidTestnetSettlementArtifact } from "@/lib/agents/serverHyperliquidTestnet";

interface UpstashEnv {
  url: string;
  token: string;
}

export type AgentServerExecutionRequestStatus =
  | "waiting_for_setup"
  | "adapter_not_connected"
  | "adapter_error"
  | "submitted"
  | "rejected";

export interface AgentServerExecutionRecord {
  id: string;
  request: AgentServerExecutionRequest;
  status: AgentServerExecutionRequestStatus;
  readinessState: AgentServerExecutionReadiness["state"];
  message: string;
  artifact?: HyperliquidTestnetOrderArtifact;
  artifactHash?: string;
  settlementArtifact?: HyperliquidTestnetSettlementArtifact;
  settlementArtifactHash?: string;
  settlementProposalAddress?: string;
  settlementProposalStatus?: "created" | "approved" | "executed";
  settlementTxid?: string;
  createdAt: number;
  updatedAt: number;
  version: 1;
}

export async function recordAgentServerExecutionSettlement({
  walletName,
  agentId,
  requestId,
  artifact,
}: {
  walletName: string;
  agentId: string;
  requestId: string;
  artifact: HyperliquidTestnetSettlementArtifact;
}): Promise<AgentServerExecutionRecordResult> {
  const key = executionKey(walletName, agentId);
  const redis = readUpstashEnv();
  const current = redis
    ? await redisGet<AgentServerExecutionRecord[]>(executionRedisKey(key), redis) ?? []
    : EXECUTIONS.get(key) ?? [];
  const existing = current.find((item) => item.id === requestId);
  if (!existing) throw new Error("Stored venue execution request was not found.");
  if (existing.settlementArtifact) {
    if (settlementClaimHash(existing.settlementArtifact) !== settlementClaimHash(artifact)) {
      throw new Error("Verified venue evidence does not match the stored settlement claim.");
    }
    if (existing.settlementArtifact.venueEvidence?.evidenceHash === artifact.venueEvidence.evidenceHash) {
      return { record: existing, duplicate: true };
    }
  }
  const nextRecord: AgentServerExecutionRecord = {
    ...existing,
    settlementArtifact: artifact,
    settlementArtifactHash: hashAgentServerExecutionArtifact(artifact),
    message: `Hyperliquid testnet position closed by order ${artifact.closingOrderId}. On-chain settlement approval is required.`,
    updatedAt: Date.now(),
  };
  const next = current.map((item) => item.id === requestId ? nextRecord : item);
  if (redis) await redisSet(executionRedisKey(key), next, redis);
  else EXECUTIONS.set(key, next);
  return { record: nextRecord, duplicate: false };
}

export async function recordAgentServerExecutionSettlementProof({
  walletName,
  agentId,
  requestId,
  proposalAddress,
  status,
  txid,
}: {
  walletName: string;
  agentId: string;
  requestId: string;
  proposalAddress: string;
  status: "created" | "approved" | "executed";
  txid?: string;
}): Promise<AgentServerExecutionRecord> {
  const key = executionKey(walletName, agentId);
  const redis = readUpstashEnv();
  const current = redis
    ? await redisGet<AgentServerExecutionRecord[]>(executionRedisKey(key), redis) ?? []
    : EXECUTIONS.get(key) ?? [];
  const existing = current.find((item) => item.id === requestId);
  if (!existing?.settlementArtifact) {
    throw new Error("Trusted venue settlement artifact was not found.");
  }
  const nextRecord = {
    ...existing,
    settlementProposalAddress: proposalAddress,
    settlementProposalStatus: status,
    settlementTxid: txid,
    updatedAt: Date.now(),
  };
  const next = current.map((item) => item.id === requestId ? nextRecord : item);
  if (redis) await redisSet(executionRedisKey(key), next, redis);
  else EXECUTIONS.set(key, next);
  return nextRecord;
}

export interface AgentServerExecutionRecordResult {
  record: AgentServerExecutionRecord;
  duplicate: boolean;
}

const EXECUTIONS = new Map<string, AgentServerExecutionRecord[]>();
const MAX_RECORDS_PER_AGENT = 50;

export async function recordAgentServerExecutionRequest({
  request,
  readiness,
  status,
  message,
  artifact,
}: {
  request: AgentServerExecutionRequest;
  readiness: AgentServerExecutionReadiness;
  status?: AgentServerExecutionRequestStatus;
  message?: string;
  artifact?: HyperliquidTestnetOrderArtifact;
}): Promise<AgentServerExecutionRecordResult> {
  const key = executionKey(request.walletName, request.agentId);
  const redis = readUpstashEnv();
  const current = redis
    ? await redisGet<AgentServerExecutionRecord[]>(executionRedisKey(key), redis) ?? []
    : EXECUTIONS.get(key) ?? [];
  const existingIndex = current.findIndex(
    (item) =>
      item.request.proposalId === request.proposalId &&
      item.request.venue === request.venue,
  );
  const existing = existingIndex >= 0 ? current[existingIndex] : undefined;
  if (existing) {
    if (!isRetryable(existing.status) || status === existing.status) {
      return { record: existing, duplicate: true };
    }
  }

  const now = Date.now();
  const record: AgentServerExecutionRecord = {
    id: newExecutionRequestId(),
    request,
    status: status ?? statusForReadiness(readiness),
    readinessState: readiness.state,
    message: message ?? readiness.message,
    artifact,
    artifactHash: artifact ? hashAgentServerExecutionArtifact(artifact) : undefined,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  const next =
    existingIndex >= 0
      ? current.map((item, index) => (index === existingIndex ? record : item))
      : [record, ...current].slice(0, MAX_RECORDS_PER_AGENT);
  if (redis) {
    await redisSet(executionRedisKey(key), next, redis);
  } else {
    EXECUTIONS.set(key, next);
  }
  return { record, duplicate: false };
}

function isRetryable(status: AgentServerExecutionRequestStatus): boolean {
  return status === "rejected" || status === "adapter_error";
}

export async function listAgentServerExecutionRequests(
  walletName: string,
  agentId: string,
): Promise<AgentServerExecutionRecord[]> {
  const key = executionKey(walletName, agentId);
  const redis = readUpstashEnv();
  if (redis) {
    return await redisGet<AgentServerExecutionRecord[]>(executionRedisKey(key), redis) ?? [];
  }
  return [...(EXECUTIONS.get(key) ?? [])];
}

export function agentServerExecutionStorageMode(): "redis" | "memory" {
  return readUpstashEnv() ? "redis" : "memory";
}

export function hashAgentServerExecutionArtifact(
  artifact: HyperliquidTestnetOrderArtifact | HyperliquidTestnetSettlementArtifact,
): string {
  return createHash("sha256").update(stableJson(artifact)).digest("hex");
}

function statusForReadiness(
  readiness: AgentServerExecutionReadiness,
): AgentServerExecutionRequestStatus {
  if (readiness.state === "not_configured") return "waiting_for_setup";
  if (readiness.state === "ready") return "adapter_not_connected";
  return "rejected";
}

function executionKey(walletName: string, agentId: string): string {
  return `${walletName}:${agentId}`;
}

function executionRedisKey(key: string): string {
  return `agent:execution-requests:${hashStorageKey(key)}`;
}

function hashStorageKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(",")}}`;
}

function settlementClaimHash(artifact: HyperliquidTestnetSettlementArtifact): string {
  const { venueEvidence: _venueEvidence, ...claim } = artifact;
  void _venueEvidence;
  return createHash("sha256").update(stableJson(claim)).digest("hex");
}

function newExecutionRequestId(): string {
  try {
    return randomUUID();
  } catch {
    return `agent_execution_request_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function readUpstashEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function redisGet<T>(key: string, env: UpstashEnv): Promise<T | null> {
  const result = await redisCommand(["GET", key], env);
  if (typeof result !== "string") return null;
  try {
    return JSON.parse(result) as T;
  } catch {
    return null;
  }
}

async function redisSet<T>(key: string, value: T, env: UpstashEnv): Promise<void> {
  await redisCommand(["SET", key, JSON.stringify(value)], env);
}

async function redisCommand(command: string[], env: UpstashEnv): Promise<unknown> {
  const response = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.token}`,
    },
    body: JSON.stringify([command]),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`Execution request store returned ${response.status}`);
  }
  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (payload[0]?.error) {
    throw new Error(payload[0].error);
  }
  return payload[0]?.result ?? null;
}
