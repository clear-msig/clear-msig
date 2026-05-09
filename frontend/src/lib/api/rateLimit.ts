// Per-IP rate limiter with two backends.
//
// 1. Default: in-process token bucket. Cheap and free, but Vercel
//    function instances don't share memory so a parallel-cold-start
//    attack can exceed the limit.
// 2. Upstash Redis (REST): fixed-window counter shared across every
//    instance. Activates when both UPSTASH_REDIS_REST_URL and
//    UPSTASH_REDIS_REST_TOKEN are present in the environment. Falls
//    back to in-process if the REST call fails (fail-open: a KV
//    outage shouldn't block real users; the in-process limiter still
//    catches the obvious loop).
//
// Caller signature is the same in both modes - just `await` the
// result. No code change needed at call sites to enable Upstash.

import { NextResponse } from "next/server";

export interface Limit {
  /// Maximum tokens (burst size, also the per-window cap in Upstash mode).
  capacity: number;
  /// Token refill per second. With Upstash, the window size is derived
  /// as `ceil(capacity / refillPerSec)` seconds.
  refillPerSec: number;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
}

const BUCKETS = new Map<string, Bucket>();
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;
let lastPruneMs = 0;

/// Returns null when the request is within budget, or a 429
/// NextResponse to short-circuit the handler when over budget. Always
/// pair the IP with a route-specific scope so endpoints don't share
/// buckets.
export async function checkRateLimit(
  scope: string,
  ip: string,
  limit: Limit,
): Promise<NextResponse | null> {
  const upstash = readUpstashEnv();
  if (upstash) {
    const blocked = await checkUpstash(scope, ip, limit, upstash);
    if (blocked) return blocked;
    // Even when Upstash says yes, run the in-process check. Belt and
    // braces: a single warm instance still benefits from the bucket
    // even if the KV call slipped through during a cold-start race.
  }
  return checkInProcess(scope, ip, limit);
}

// ── In-process token bucket ─────────────────────────────────────────

function checkInProcess(
  scope: string,
  ip: string,
  limit: Limit,
): NextResponse | null {
  pruneIfStale();

  const key = `${scope}:${ip}`;
  const now = Date.now();
  const bucket = BUCKETS.get(key) ?? {
    tokens: limit.capacity,
    lastRefillMs: now,
  };

  const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
  bucket.tokens = Math.min(
    limit.capacity,
    bucket.tokens + elapsedSec * limit.refillPerSec,
  );
  bucket.lastRefillMs = now;

  if (bucket.tokens < 1) {
    BUCKETS.set(key, bucket);
    const retryAfterSec = Math.ceil((1 - bucket.tokens) / limit.refillPerSec);
    return tooMany(retryAfterSec);
  }

  bucket.tokens -= 1;
  BUCKETS.set(key, bucket);
  return null;
}

function pruneIfStale(): void {
  const now = Date.now();
  if (now - lastPruneMs < PRUNE_INTERVAL_MS) return;
  lastPruneMs = now;
  for (const [key, bucket] of BUCKETS) {
    if (now - bucket.lastRefillMs > PRUNE_INTERVAL_MS) {
      BUCKETS.delete(key);
    }
  }
}

// ── Upstash Redis (fixed-window via INCR + EXPIRE NX) ───────────────

interface UpstashEnv {
  url: string;
  token: string;
}

function readUpstashEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function checkUpstash(
  scope: string,
  ip: string,
  limit: Limit,
  env: UpstashEnv,
): Promise<NextResponse | null> {
  const windowSec = Math.max(
    1,
    Math.ceil(limit.capacity / Math.max(0.000001, limit.refillPerSec)),
  );
  const key = `rl:${scope}:${ip}:${windowSec}`;
  const body = [
    ["INCR", key],
    ["EXPIRE", key, String(windowSec), "NX"],
  ];

  let count: number;
  try {
    const resp = await fetch(`${env.url}/pipeline`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.token}`,
      },
      body: JSON.stringify(body),
      // Upstash is fast; cap at 1.5s so a slow REST call can't
      // multiply the cost it's meant to defend against.
      signal: AbortSignal.timeout(1500),
    });
    if (!resp.ok) {
      console.warn(`[rateLimit] Upstash returned ${resp.status}`);
      return null;
    }
    const json = (await resp.json()) as Array<{ result?: number | string }>;
    count = Number(json?.[0]?.result ?? 0);
  } catch (err) {
    // Fail-open. The in-process limiter still runs after this returns.
    console.warn("[rateLimit] Upstash request failed", err);
    return null;
  }

  if (count > limit.capacity) {
    return tooMany(windowSec);
  }
  return null;
}

function tooMany(retryAfterSec: number): NextResponse {
  return NextResponse.json(
    { error: "Too many requests. Slow down and try again." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.max(1, retryAfterSec)) },
    },
  );
}
