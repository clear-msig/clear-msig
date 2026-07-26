"use client";

// Multi-provider failover for EVM read calls. Mirrors the proxy
// pattern in lib/solana/cluster.ts but for the EVM destination
// chain - the public Sepolia RPC has been the source of every
// "balance flickered" / "gas estimate empty" report we've had on
// Ethereum, and a single misbehaving provider shouldn't kill the
// dashboard for everyone.
//
// What this does NOT cover:
//   - Broadcast (eth_sendRawTransaction). Re-sending the same
//     signed tx to multiple providers is fine in theory (idempotent
//     on chain) but the failure mode of a half-landed broadcast is
//     bad UX: the second provider returns "already known" and the
//     CLI thinks it's a fresh failure. So broadcast stays
//     single-URL - `crates/clear-msig-execution/src/chains/evm.rs` handles that path.
//   - Subscriptions. We don't use eth_subscribe anywhere yet.
//
// Order of attempts (per call):
//   1. User override (lib/config.ts → EVM_RPC_OVERRIDE_STORAGE_KEY)
//   2. Env default (NEXT_PUBLIC_DESTINATION_RPC_URL on Vercel)
//   3. Public Sepolia pool (below)
//
// Each URL gets one shot. On network-level failure (TypeError,
// fetch failed, rate-limit / 5xx), we move on to the next. Logical
// errors (eth_call returns "execution reverted") propagate
// immediately - no point retrying those, and retrying could mask
// genuine contract bugs.

import { appConfig, EVM_RPC_OVERRIDE_STORAGE_KEY, destinationRpcDefault } from "@/lib/config";

/// Public Sepolia RPCs ordered by historical reliability + free-tier
/// generosity. 1RPC is intentionally first because it's the new
/// default (publicnode has been throwing `ERR_CONNECTION_CLOSED` in
/// production, blastapi blocks clearsig.xyz at the CORS layer). The
/// rest are independent providers so a single outage doesn't take
/// everything down. Add more here as we collect real-world reliability
/// data.
const PUBLIC_SEPOLIA_FALLBACKS: readonly string[] = [
  "https://1rpc.io/sepolia",
  "https://sepolia.gateway.tenderly.co",
  "https://rpc.ankr.com/eth_sepolia",
  "https://ethereum-sepolia.api.onfinality.io/public",
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://eth-sepolia.public.blastapi.io",
];

function readOverrideFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(EVM_RPC_OVERRIDE_STORAGE_KEY);
    if (typeof v === "string" && /^https?:\/\/[^\s]+$/i.test(v.trim())) {
      return v.trim();
    }
    return null;
  } catch {
    return null;
  }
}

/// Build the ordered URL pool for read calls. De-duplicates so the
/// same provider doesn't get hit twice in a single retry round
/// (common when the override or env default already matches one
/// of the public fallbacks).
export function evmReadRpcCandidates(explicitFirst?: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (url: string | null | undefined) => {
    if (!url) return;
    const trimmed = url.trim();
    if (!trimmed) return;
    const key = trimmed.replace(/\/+$/, "").toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(trimmed);
  };
  push(explicitFirst);
  push(readOverrideFromStorage());
  push(appConfig.preAlpha.destinationRpcUrl);
  push(destinationRpcDefault);
  for (const url of PUBLIC_SEPOLIA_FALLBACKS) push(url);
  return out;
}

const NETWORK_ERROR_PATTERNS = [
  /failed to fetch/i,
  /fetch failed/i,
  /load failed/i, // Safari
  /network/i,
  /\baborted\b/i,
  /\btimed? out\b/i,
  /econn/i,
  /typeerror/i,
];

function isRetryableNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return NETWORK_ERROR_PATTERNS.some((p) => p.test(msg));
}

function isRetryableHttpStatus(status: number): boolean {
  // 5xx and 429 (rate limit) are worth retrying on a different
  // provider. 4xx other than 429 indicate a logical error (bad
  // params, contract revert) and should propagate.
  return status >= 500 || status === 429;
}

/// Try `fn` against each URL in `candidates`, returning the first
/// successful result. `fn` is expected to throw on network-level
/// errors AND on retryable HTTP statuses (5xx / 429). The wrapper
/// surfaces the LAST error if every URL fails so the user sees
/// something concrete instead of an empty "all providers down".
export async function withEvmFallback<T>(
  fn: (rpcUrl: string) => Promise<T>,
  explicitFirst?: string,
): Promise<T> {
  const urls = evmReadRpcCandidates(explicitFirst);
  if (urls.length === 0) {
    throw new Error("No EVM RPC URLs configured");
  }
  let lastError: unknown;
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      return await fn(url);
    } catch (err) {
      lastError = err;
      // Logical errors propagate immediately - the next provider
      // would just fail the same way (or return a stale value).
      const retryable = isRetryableNetworkError(err) || isHttpRetryable(err);
      if (!retryable) throw err;
      // Continue to the next URL.
    }
  }
  throw new Error(
    `All ${urls.length} EVM RPC providers failed. Last error: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/// Helper: HTTP-status-based retry detection. Callers throw with
/// a message like "HTTP 503" or "Blockscout returned HTTP 502".
function isHttpRetryable(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/HTTP\s+(\d{3})/i);
  if (!m) return false;
  const status = parseInt(m[1], 10);
  if (!Number.isFinite(status)) return false;
  return isRetryableHttpStatus(status);
}
