// Ramp service API client.
//
// rust-settlement runs as a sidecar to clear-msig (separate Fly app);
// every call goes through this client so the URL, auth header, and
// idempotency-key handling live in one place.
//
// Identity:
//   - Every protected call carries the current signed Dynamic JWT.
//   - Settlement verifies its signature, issuer, environment, audience, expiry,
//     and authenticated subject; wallet addresses are never identity proof.
//   - A selected Solana wallet is checked against the JWT's signed credentials.
//
// Idempotency:
//   - Every mutating call generates a `crypto.randomUUID()`
//     idempotency-key. Replays with the same payload return the same
//     intent_id; replays with a different payload error out.
//
// All responses go through the standard `{ success, data }` envelope.

import { getRampAuthToken } from "@/lib/ramp/sessionToken";

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

// ── Internal request plumbing ───────────────────────────────────────

interface RequestOptions {
  pubkey?: string;
  idempotencyKey?: string;
  signal?: AbortSignal;
  public?: boolean;
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
  if (!opts.public) {
    const token = getRampAuthToken();
    if (!token) {
      throw new RampApiError(
        "Sign in with Dynamic to use bank transfers. A connected wallet alone is not an authenticated session.",
        401,
      );
    }
    headers.authorization = `Bearer ${token}`;
  }
  if (opts.pubkey) {
    headers["x-wallet-address"] = opts.pubkey;
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
      { signal, public: true },
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
