// Auto-retry for transient submit errors.
//
// Solana RPCs return a small set of "the cluster did not see this
// yet" errors that are safe to retry verbatim: blockhash not found,
// node behind, slot was skipped, transaction simulation failed
// (often because the previous tx is still confirming). When the
// signed payload is bound to a fixed proposal index + nonce, the
// retry targets the same on-chain slot — so if the original tx
// silently landed, the retry fails fast with "already approved" /
// "account already in use", which we let through to the catch-all.
//
// Default policy: 1 retry, 800ms wait. Don't retry on:
//   - non-transient errors (programmer mistakes, bad input, etc.)
//   - rate-limit errors (the user's own retry would spike harder)
//   - wallet rejections (already failed before reaching submit)
//   - "already" terminal-OK errors (the tx landed)

import { BackendApiError } from "@/lib/api/client";
import { WalletSignError } from "@/lib/hooks/useSignWithWallet";

export interface RetryOptions {
  /// Total attempts including the initial call. Default 2 (one retry).
  maxAttempts?: number;
  /// Delay between attempts in milliseconds. Default 800.
  delayMs?: number;
  /// Override the default predicate. Receives the thrown error.
  shouldRetry?: (err: unknown) => boolean;
  /// Hook for telemetry / dev visibility on each retried attempt.
  onRetry?: (err: unknown, attempt: number) => void;
}

/// Default transient signatures we retry on. Lowercased + matched as
/// substrings against the error message (and stderr/payload for
/// BackendApiError).
const TRANSIENT_HINTS = [
  "blockhash not found",
  "node is behind",
  "nodebehind",
  "slot was skipped",
  "transaction simulation failed",
  "tx simulation failed",
  "rpc response error -32007", // slot skipped
  "rpc response error -32004", // node behind
  "rpc response error -32014", // min context slot
  "rpc response error -32016",
];

/// Errors we treat as terminal-OK: the operation already happened.
/// The caller layer (`friendlyError`) maps these to "this request has
/// already been handled" copy.
const TERMINAL_OK_HINTS = [
  "already in use",
  "alreadyinitialized",
  "already approved",
  "already executed",
  "already cancelled",
];

/// Run `fn` with auto-retry on transient errors. The original error
/// is rethrown when retries are exhausted or the predicate says no.
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const max = Math.max(1, opts.maxAttempts ?? 2);
  const delay = Math.max(0, opts.delayMs ?? 800);
  const should = opts.shouldRetry ?? defaultShouldRetry;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === max || !should(err)) throw err;
      opts.onRetry?.(err, attempt);
      if (delay > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastErr;
}

function defaultShouldRetry(err: unknown): boolean {
  // Never retry user rejections or message-mismatch errors.
  if (err instanceof WalletSignError) return false;

  const hay = errorHaystack(err);
  if (TERMINAL_OK_HINTS.some((s) => hay.includes(s))) return false;
  if (hay.includes("rate limit") || hay.includes("too many requests")) {
    return false;
  }
  return TRANSIENT_HINTS.some((s) => hay.includes(s));
}

function errorHaystack(err: unknown): string {
  if (err instanceof BackendApiError) {
    return [
      err.message,
      err.payload?.error,
      err.payload?.stderr,
      err.payload?.stdout,
    ]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
  }
  if (err instanceof Error) return err.message.toLowerCase();
  if (typeof err === "string") return err.toLowerCase();
  return "";
}
