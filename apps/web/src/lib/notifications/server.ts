import { createHash } from "node:crypto";
import type {
  NotificationEventInput,
  NotificationFeedEntry,
  NotificationIngestResult,
} from "@/lib/notifications/types";

interface UpstashEnv {
  url: string;
  token: string;
}

export class NotificationPersistenceError extends Error {}

const memoryFeeds = new Map<string, Map<string, NotificationFeedEntry>>();
const MAX_ENTRIES = 200;

export async function listServerNotifications(
  userId: string,
): Promise<NotificationFeedEntry[]> {
  const redis = storageEnv();
  if (!redis) return memoryRows(userId);
  const [entriesKey, orderKey] = redisKeys(userId);
  const result = await redisCommand(
    ["EVAL", LIST_SCRIPT, "2", entriesKey, orderKey, String(MAX_ENTRIES)],
    redis,
  );
  return parseRedisEntries(result);
}

export async function ingestServerNotifications(
  userId: string,
  inputs: NotificationEventInput[],
): Promise<NotificationIngestResult[]> {
  const now = Date.now();
  const entries = inputs.map((input) => normalizeEntry(userId, input, now));
  const redis = storageEnv();
  if (!redis) return ingestMemory(userId, entries);
  const [entriesKey, orderKey] = redisKeys(userId);
  const results: NotificationIngestResult[] = [];
  for (const entry of entries) {
    const result = await redisCommand(
      [
        "EVAL",
        INGEST_SCRIPT,
        "2",
        entriesKey,
        orderKey,
        entry.id,
        JSON.stringify(entry),
        String(entry.createdAt),
        String(MAX_ENTRIES),
      ],
      redis,
    );
    const tuple = Array.isArray(result) ? result : [];
    const stored = parseEntry(tuple[1]) ?? entry;
    results.push({ inserted: Number(tuple[0]) === 1, entry: stored });
  }
  return results;
}

export async function markServerNotificationSeen(
  userId: string,
  id: string,
): Promise<NotificationFeedEntry | null> {
  const redis = storageEnv();
  if (!redis) {
    const feed = memoryFeeds.get(userId);
    const entry = feed?.get(id);
    if (!entry) return null;
    const next = entry.seenAt ? entry : { ...entry, seenAt: Date.now() };
    feed?.set(id, next);
    return next;
  }
  const [entriesKey] = redisKeys(userId);
  const result = await redisCommand(
    ["EVAL", MARK_SEEN_SCRIPT, "1", entriesKey, id, String(Date.now())],
    redis,
  );
  return parseEntry(result);
}

export async function markAllServerNotificationsSeen(userId: string): Promise<void> {
  const redis = storageEnv();
  const seenAt = Date.now();
  if (!redis) {
    const feed = memoryFeeds.get(userId);
    if (!feed) return;
    for (const [id, entry] of feed) {
      if (!entry.seenAt) feed.set(id, { ...entry, seenAt });
    }
    return;
  }
  const [entriesKey, orderKey] = redisKeys(userId);
  await redisCommand(
    ["EVAL", MARK_ALL_SEEN_SCRIPT, "2", entriesKey, orderKey, String(seenAt)],
    redis,
  );
}

export function notificationStorageMode(): "redis" | "memory" {
  return readUpstashEnv() ? "redis" : "memory";
}

export function resetNotificationMemoryForTests(): void {
  memoryFeeds.clear();
}

function normalizeEntry(
  userId: string,
  input: NotificationEventInput,
  now: number,
): NotificationFeedEntry {
  const createdAt =
    typeof input.createdAt === "number" &&
    Number.isFinite(input.createdAt) &&
    Math.abs(input.createdAt - now) < 366 * 24 * 60 * 60 * 1_000
      ? Math.floor(input.createdAt)
      : now;
  return {
    id: createHash("sha256")
      .update(`${userId}\0${input.sourceId}`)
      .digest("hex")
      .slice(0, 32),
    sourceId: input.sourceId,
    kind: input.kind,
    walletName: input.walletName,
    title: input.title,
    body: input.body,
    href: input.href,
    createdAt,
  };
}

function ingestMemory(
  userId: string,
  entries: NotificationFeedEntry[],
): NotificationIngestResult[] {
  const feed = memoryFeeds.get(userId) ?? new Map<string, NotificationFeedEntry>();
  memoryFeeds.set(userId, feed);
  const results = entries.map((entry) => {
    const existing = feed.get(entry.id);
    if (existing) return { entry: existing, inserted: false };
    feed.set(entry.id, entry);
    return { entry, inserted: true };
  });
  const ordered = [...feed.values()].sort((a, b) => b.createdAt - a.createdAt);
  for (const entry of ordered.slice(MAX_ENTRIES)) feed.delete(entry.id);
  return results;
}

function memoryRows(userId: string): NotificationFeedEntry[] {
  return [...(memoryFeeds.get(userId)?.values() ?? [])]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_ENTRIES);
}

function redisKeys(userId: string): [string, string] {
  const key = createHash("sha256").update(userId).digest("hex").slice(0, 40);
  return [`notifications:${key}:entries`, `notifications:${key}:order`];
}

function storageEnv(): UpstashEnv | null {
  const env = readUpstashEnv();
  if (env) return env;
  if (process.env.NODE_ENV === "production") {
    throw new NotificationPersistenceError(
      "Notification sync requires Redis in production.",
    );
  }
  return null;
}

function readUpstashEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url, token } : null;
}

async function redisCommand(command: string[], env: UpstashEnv): Promise<unknown> {
  const response = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.token}`,
    },
    body: JSON.stringify([command]),
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok) throw new NotificationPersistenceError("Notification store unavailable.");
  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (payload[0]?.error) throw new NotificationPersistenceError(payload[0].error);
  return payload[0]?.result ?? null;
}

function parseRedisEntries(value: unknown): NotificationFeedEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseEntry).filter((entry): entry is NotificationFeedEntry => !!entry);
}

function parseEntry(value: unknown): NotificationFeedEntry | null {
  if (typeof value !== "string") return null;
  try {
    const entry = JSON.parse(value) as NotificationFeedEntry;
    return entry && typeof entry.id === "string" ? entry : null;
  } catch {
    return null;
  }
}

const INGEST_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if existing then return {0, existing} end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('ZADD', KEYS[2], ARGV[3], ARGV[1])
local count = redis.call('ZCARD', KEYS[2])
local limit = tonumber(ARGV[4])
if count > limit then
  local stale = redis.call('ZRANGE', KEYS[2], 0, count - limit - 1)
  for _, id in ipairs(stale) do redis.call('HDEL', KEYS[1], id) end
  if #stale > 0 then redis.call('ZREM', KEYS[2], unpack(stale)) end
end
return {1, ARGV[2]}
`;

const LIST_SCRIPT = `
local ids = redis.call('ZREVRANGE', KEYS[2], 0, tonumber(ARGV[1]) - 1)
local rows = {}
for _, id in ipairs(ids) do
  local row = redis.call('HGET', KEYS[1], id)
  if row then table.insert(rows, row) end
end
return rows
`;

const MARK_SEEN_SCRIPT = `
local raw = redis.call('HGET', KEYS[1], ARGV[1])
if not raw then return nil end
local row = cjson.decode(raw)
if not row.seenAt then
  row.seenAt = tonumber(ARGV[2])
  raw = cjson.encode(row)
  redis.call('HSET', KEYS[1], ARGV[1], raw)
end
return raw
`;

const MARK_ALL_SEEN_SCRIPT = `
local ids = redis.call('ZRANGE', KEYS[2], 0, -1)
for _, id in ipairs(ids) do
  local raw = redis.call('HGET', KEYS[1], id)
  if raw then
    local row = cjson.decode(raw)
    if not row.seenAt then
      row.seenAt = tonumber(ARGV[1])
      redis.call('HSET', KEYS[1], id, cjson.encode(row))
    end
  end
end
return #ids
`;
