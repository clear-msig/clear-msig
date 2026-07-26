// Ramp service API client.
//
// rust-settlement runs as a sidecar to clear-msig (separate Fly app);
// every call goes through this client so the URL, auth header, and
// idempotency-key handling live in one place.
//
// Identity:
//   - The service expects `x-user-id` as a UUID. clear-msig has no
//     `users` table; we deterministically derive a UUID from the
//     connected Solana pubkey via SHA-256(pubkey)[:16] with RFC 4122
//     version-4 / variant-1 bits set.
//   - The mapping is stable across sessions and devices for the same
//     pubkey, so the user's intent history persists.
//
// Idempotency:
//   - Every mutating call generates a `crypto.randomUUID()`
//     idempotency-key. Replays with the same payload return the same
//     intent_id; replays with a different payload error out.
//
// All responses go through the standard `{ success, data }` envelope.

import type {
  BankListItem,
  BankResolveResponse,
  ChainTransferConfirmationRequest,
  CreateRampIntentRequest,
  CreateRampIntentResponse,
  InitializePaymentResponse,
  IntentDetailResponse,
  PrepareSignatureResponse,
  RampApiEnvelope,
  RampApiErrorEnvelope,
} from "@/lib/ramp/types";

const RAMP_API_URL =
  process.env.NEXT_PUBLIC_RAMP_API_URL ?? "http://127.0.0.1:8088";

export class RampApiError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "RampApiError";
    this.status = status;
  }
}

// ── Identity ────────────────────────────────────────────────────────

/// Cache the derivation per pubkey so repeated API calls don't
/// re-hash. Hashing is fast but the cache also makes the result
/// observably stable for `useEffect` dep arrays.
const pubkeyToUuidCache = new Map<string, string>();

/// Deterministic UUID for a Solana base58 pubkey. SHA-256(pubkey),
/// take first 16 bytes, set RFC 4122 version-4 + variant-1 bits.
/// Stable, unique per pubkey, parses as a valid UUID on the backend.
export async function pubkeyToUserId(pubkey: string): Promise<string> {
  const hit = pubkeyToUuidCache.get(pubkey);
  if (hit) return hit;

  const data = new TextEncoder().encode(`clear-msig-ramp:${pubkey}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest, 0, 16);
  // RFC 4122 v4: high nibble of byte 6 = 0100
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  // RFC 4122 variant 1: top two bits of byte 8 = 10
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
    12,
    16,
  )}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;

  pubkeyToUuidCache.set(pubkey, uuid);
  return uuid;
}

// ── Internal request plumbing ───────────────────────────────────────

interface RequestOptions {
  pubkey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
}

async function request<T>(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
  opts: RequestOptions = {},
): Promise<T> {
  const url = `${rampRequestBase()}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  if (opts.pubkey) {
    headers["x-user-id"] = await pubkeyToUserId(opts.pubkey);
  }
  if (opts.idempotencyKey) {
    headers["idempotency-key"] = opts.idempotencyKey;
  }

  const resp = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
    signal: opts.signal,
  });

  // Try to parse JSON regardless; the error envelope is the same shape.
  let parsed: unknown = null;
  try {
    parsed = await resp.json();
  } catch {
    /* opaque error body - fall through */
  }

  if (!resp.ok) {
    const err = parsed as RampApiErrorEnvelope | null;
    throw new RampApiError(
      err?.error ?? `Ramp request failed (${resp.status})`,
      resp.status,
    );
  }

  const envelope = parsed as RampApiEnvelope<T> | null;
  if (!envelope || envelope.success !== true) {
    throw new RampApiError("Unexpected ramp response shape");
  }
  return envelope.data;
}

export function rampRequestBase(): string {
  return typeof window === "undefined"
    ? RAMP_API_URL.replace(/\/$/, "")
    : "/api/ramp";
}

// ── Public surface ──────────────────────────────────────────────────

export const rampApi = {
  /// Create a fresh idempotency key. Call once per submit; pass it
  /// into `createIntent` so retries are safe.
  newIdempotencyKey(): string {
    return typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  },

  async createIntent(
    pubkey: string,
    body: CreateRampIntentRequest,
    idempotencyKey: string,
    signal?: AbortSignal,
  ): Promise<CreateRampIntentResponse> {
    return request<CreateRampIntentResponse>(
      "POST",
      "/v1/ramp/intents",
      body,
      { pubkey, idempotencyKey, signal },
    );
  },

  async getIntent(
    pubkey: string,
    intentId: string,
    signal?: AbortSignal,
  ): Promise<IntentDetailResponse> {
    return request<IntentDetailResponse>(
      "GET",
      `/v1/ramp/intents/${encodeURIComponent(intentId)}`,
      undefined,
      { pubkey, signal },
    );
  },

  async initializePayment(
    pubkey: string,
    intentId: string,
    signal?: AbortSignal,
  ): Promise<InitializePaymentResponse> {
    return request<InitializePaymentResponse>(
      "POST",
      `/v1/ramp/intents/${encodeURIComponent(intentId)}/initialize-payment`,
      undefined,
      { pubkey, signal },
    );
  },

  async prepareSignature(
    pubkey: string,
    intentId: string,
    signal?: AbortSignal,
  ): Promise<PrepareSignatureResponse> {
    return request<PrepareSignatureResponse>(
      "POST",
      `/v1/ramp/intents/${encodeURIComponent(intentId)}/prepare-signature`,
      undefined,
      { pubkey, signal },
    );
  },

  async listBanks(
    country = "nigeria",
    signal?: AbortSignal,
  ): Promise<BankListItem[]> {
    return request<BankListItem[]>(
      "GET",
      `/v1/ramp/banks?country=${encodeURIComponent(country)}`,
      undefined,
      { signal },
    );
  },

  async resolveBank(
    accountNumber: string,
    bankCode: string,
    signal?: AbortSignal,
  ): Promise<BankResolveResponse> {
    const qs = new URLSearchParams({
      account_number: accountNumber,
      bank_code: bankCode,
    }).toString();
    return request<BankResolveResponse>(
      "GET",
      `/v1/ramp/bank/resolve?${qs}`,
      undefined,
      { signal },
    );
  },

  async confirmChainTransfer(
    payload: ChainTransferConfirmationRequest,
    signal?: AbortSignal,
  ): Promise<{ accepted: boolean }> {
    return request<{ accepted: boolean }>(
      "POST",
      "/v1/internal/chain/confirm",
      payload,
      { signal },
    );
  },
};
