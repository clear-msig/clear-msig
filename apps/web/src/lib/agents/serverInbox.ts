import { createHash, randomUUID } from "crypto";
import type { AgentSignalPayload } from "@/lib/agents/intake";
import type { AgentSignalInboxItem } from "@/lib/agents/types";

interface RegisteredAgentKey {
  keyHash: string;
  managementKeyHash: string;
  autoImportSessionSignals?: boolean;
  allowedOrigins?: string[];
  registeredAt: number;
}

interface UpstashEnv {
  url: string;
  token: string;
}

export interface AgentSignalEnqueueResult {
  item: AgentSignalInboxItem;
  duplicate: boolean;
  accepted: boolean;
  abuseFlags: string[];
}

const REGISTRY = new Map<string, RegisteredAgentKey>();
const INBOX = new Map<string, AgentSignalInboxItem[]>();
const RATE_WINDOWS = new Map<string, number[]>();
const MAX_ITEMS_PER_AGENT = 50;
const DEFAULT_SIGNAL_LIMIT = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_SIGNAL_FUTURE_SKEW_MS = 5 * 60_000;
const MAX_SIGNAL_AGE_MS = 24 * 60 * 60_000;

export async function registerAgentSignalKey({
  walletName,
  agentId,
  signalKey,
  managementKey,
  autoImportSessionSignals = false,
  allowedOrigins = [],
}: {
  walletName: string;
  agentId: string;
  signalKey: string;
  managementKey: string;
  autoImportSessionSignals?: boolean;
  allowedOrigins?: string[];
}): Promise<void> {
  const value: RegisteredAgentKey = {
    keyHash: hashSignalKey(signalKey),
    managementKeyHash: hashSignalKey(managementKey),
    autoImportSessionSignals,
    allowedOrigins: normalizeOrigins(allowedOrigins),
    registeredAt: Date.now(),
  };
  const redis = readUpstashEnv();
  if (redis) {
    const existing = await redisGet<RegisteredAgentKey>(
      registryRedisKey(walletName, agentId),
      redis,
    );
    if (existing?.managementKeyHash && existing.managementKeyHash !== value.managementKeyHash) {
      throw new Error("Invalid inbox management key.");
    }
    await redisSet(registryRedisKey(walletName, agentId), value, redis);
    return;
  }
  const existing = REGISTRY.get(inboxKey(walletName, agentId));
  if (existing?.managementKeyHash && existing.managementKeyHash !== value.managementKeyHash) {
    throw new Error("Invalid inbox management key.");
  }
  REGISTRY.set(inboxKey(walletName, agentId), value);
}

export async function agentAutomaticTradingEnabled(
  walletName: string,
  agentId: string,
): Promise<boolean> {
  const redis = readUpstashEnv();
  const registered = redis
    ? await redisGet<RegisteredAgentKey>(registryRedisKey(walletName, agentId), redis)
    : REGISTRY.get(inboxKey(walletName, agentId));
  return registered?.autoImportSessionSignals === true;
}

export async function verifyAgentManagementKey({
  walletName,
  agentId,
  managementKey,
}: {
  walletName: string;
  agentId: string;
  managementKey: string;
}): Promise<boolean> {
  const redis = readUpstashEnv();
  const registered = redis
    ? await redisGet<RegisteredAgentKey>(registryRedisKey(walletName, agentId), redis)
    : REGISTRY.get(inboxKey(walletName, agentId));
  if (!registered?.managementKeyHash) return false;
  return registered.managementKeyHash === hashSignalKey(managementKey);
}

export async function verifyAgentSignalKey({
  walletName,
  agentId,
  signalKey,
}: {
  walletName: string;
  agentId: string;
  signalKey: string;
}): Promise<boolean> {
  const redis = readUpstashEnv();
  const registered = redis
    ? await redisGet<RegisteredAgentKey>(registryRedisKey(walletName, agentId), redis)
    : REGISTRY.get(inboxKey(walletName, agentId));
  if (!registered) return false;
  return registered.keyHash === hashSignalKey(signalKey);
}

export async function enqueueAgentSignal({
  walletName,
  agentId,
  payload,
  origin,
  now = Date.now(),
}: {
  walletName: string;
  agentId: string;
  payload: AgentSignalPayload;
  origin?: string | null;
  now?: number;
}): Promise<AgentSignalEnqueueResult> {
  const key = inboxKey(walletName, agentId);
  const registered = await readRegisteredAgentKey(walletName, agentId);
  const abuseFlags = signalAbuseFlags({
    payload,
    registered,
    origin,
    now,
  });
  const item: AgentSignalInboxItem = {
    id: newInboxItemId(),
    walletName,
    agentId,
    payload,
    receivedAt: now,
    version: 1,
  };
  if (abuseFlags.length > 0) {
    return { item, duplicate: false, accepted: false, abuseFlags };
  }
  const redis = readUpstashEnv();
  if (redis) {
    const redisKey = inboxRedisKey(walletName, agentId);
    const list = await redisGet<AgentSignalInboxItem[]>(redisKey, redis);
    const existing = findDuplicateSignal(list ?? [], payload.clientSignalId);
    if (existing) return { item: existing, duplicate: true, accepted: true, abuseFlags: [] };
    const rateFlags = signalRateFlags(key, now);
    if (rateFlags.length > 0) {
      return { item, duplicate: false, accepted: false, abuseFlags: rateFlags };
    }
    rememberRateWindow(key, now);
    if (payload.clientSignalId) {
      const claimed = await redisSetNx(
        idempotencyRedisKey(walletName, agentId, payload.clientSignalId),
        item.id,
        24 * 60 * 60,
        redis,
      );
      if (!claimed) {
        return { item, duplicate: true, accepted: true, abuseFlags: [] };
      }
    }
    await redisSet(redisKey, [item, ...(list ?? [])].slice(0, MAX_ITEMS_PER_AGENT), redis);
    return { item, duplicate: false, accepted: true, abuseFlags: [] };
  }
  const list = INBOX.get(key) ?? [];
  const existing = findDuplicateSignal(list, payload.clientSignalId);
  if (existing) return { item: existing, duplicate: true, accepted: true, abuseFlags: [] };
  const rateFlags = signalRateFlags(key, now);
  if (rateFlags.length > 0) {
    return { item, duplicate: false, accepted: false, abuseFlags: rateFlags };
  }
  rememberRateWindow(key, now);
  INBOX.set(key, [item, ...list].slice(0, MAX_ITEMS_PER_AGENT));
  return { item, duplicate: false, accepted: true, abuseFlags: [] };
}

export async function listAgentInboxSignals(
  walletName: string,
  agentId: string,
): Promise<AgentSignalInboxItem[]> {
  const redis = readUpstashEnv();
  if (redis) {
    return await redisGet<AgentSignalInboxItem[]>(inboxRedisKey(walletName, agentId), redis) ?? [];
  }
  return [...(INBOX.get(inboxKey(walletName, agentId)) ?? [])];
}

export async function removeAgentInboxSignals(
  walletName: string,
  agentId: string,
  ids: string[],
): Promise<number> {
  const key = inboxKey(walletName, agentId);
  const redis = readUpstashEnv();
  const current = redis
    ? await redisGet<AgentSignalInboxItem[]>(inboxRedisKey(walletName, agentId), redis) ?? []
    : INBOX.get(key) ?? [];
  const remove = new Set(ids);
  const next = current.filter((item) => !remove.has(item.id));
  if (redis) {
    await redisSet(inboxRedisKey(walletName, agentId), next, redis);
  } else {
    INBOX.set(key, next);
  }
  return current.length - next.length;
}

export function agentInboxStorageMode(): "redis" | "memory" {
  return readUpstashEnv() ? "redis" : "memory";
}

async function readRegisteredAgentKey(
  walletName: string,
  agentId: string,
): Promise<RegisteredAgentKey | undefined> {
  const redis = readUpstashEnv();
  return redis
    ? (await redisGet<RegisteredAgentKey>(registryRedisKey(walletName, agentId), redis)) ?? undefined
    : REGISTRY.get(inboxKey(walletName, agentId));
}

function signalAbuseFlags({
  payload,
  registered,
  origin,
  now,
}: {
  payload: AgentSignalPayload;
  registered?: RegisteredAgentKey;
  origin?: string | null;
  now: number;
}): string[] {
  const flags: string[] = [];
  const submittedAt = Number(payload.submittedAt ?? now);
  if (!payload.clientSignalId?.trim()) flags.push("missing_client_signal_id");
  if (!Number.isFinite(submittedAt)) {
    flags.push("missing_submitted_at");
  } else {
    if (submittedAt > now + MAX_SIGNAL_FUTURE_SKEW_MS) flags.push("submitted_at_future");
    if (submittedAt < now - MAX_SIGNAL_AGE_MS) flags.push("submitted_at_stale");
  }
  const allowedOrigins = registered?.allowedOrigins ?? [];
  const normalizedOrigin = normalizeOrigin(origin);
  if (allowedOrigins.length > 0 && (!normalizedOrigin || !allowedOrigins.includes(normalizedOrigin))) {
    flags.push("origin_not_allowed");
  }
  return flags;
}

function signalRateFlags(key: string, now: number): string[] {
  const current =
    RATE_WINDOWS.get(key)?.filter((timestamp) => timestamp > now - RATE_WINDOW_MS) ??
    [];
  const limit = Number(process.env.CLEARSIG_AGENT_SIGNAL_LIMIT_PER_MINUTE ?? DEFAULT_SIGNAL_LIMIT);
  if (current.length >= (Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_SIGNAL_LIMIT)) {
    return ["rate_limit_exceeded"];
  }
  return [];
}

function rememberRateWindow(key: string, now: number): void {
  const current = RATE_WINDOWS.get(key)?.filter((timestamp) => timestamp > now - RATE_WINDOW_MS) ?? [];
  RATE_WINDOWS.set(key, [...current, now]);
}

function normalizeOrigins(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => normalizeOrigin(value)).filter((value): value is string => Boolean(value))),
  );
}

function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    return new URL(value).origin;
  } catch {
    return value.trim().replace(/\/+$/, "");
  }
}

function inboxKey(walletName: string, agentId: string): string {
  return `${walletName}:${agentId}`;
}

function findDuplicateSignal(
  list: AgentSignalInboxItem[],
  clientSignalId: string | undefined,
): AgentSignalInboxItem | null {
  if (!clientSignalId) return null;
  return (
    list.find((item) => item.payload.clientSignalId === clientSignalId) ?? null
  );
}

function registryRedisKey(walletName: string, agentId: string): string {
  return `agent:signal-key:${hashStorageKey(inboxKey(walletName, agentId))}`;
}

function inboxRedisKey(walletName: string, agentId: string): string {
  return `agent:signals:${hashStorageKey(inboxKey(walletName, agentId))}`;
}

function idempotencyRedisKey(
  walletName: string,
  agentId: string,
  clientSignalId: string,
): string {
  return `agent:signal-id:${hashStorageKey(`${inboxKey(walletName, agentId)}:${clientSignalId}`)}`;
}

function hashSignalKey(signalKey: string): string {
  return createHash("sha256").update(signalKey).digest("hex");
}

function hashStorageKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function newInboxItemId(): string {
  try {
    return randomUUID();
  } catch {
    return `signal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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

async function redisSetNx(
  key: string,
  value: string,
  ttlSeconds: number,
  env: UpstashEnv,
): Promise<boolean> {
  const result = await redisCommand(
    ["SET", key, value, "NX", "EX", String(ttlSeconds)],
    env,
  );
  return result === "OK";
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
    throw new Error(`Signal inbox store returned ${response.status}`);
  }
  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (payload[0]?.error) {
    throw new Error(payload[0].error);
  }
  return payload[0]?.result ?? null;
}
