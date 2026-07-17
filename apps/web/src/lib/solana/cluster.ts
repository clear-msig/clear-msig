// Solana cluster endpoint selection + fallback-aware Connection factory.
//
// Why this isn't just `new Connection(url)`:
//
// We've seen production breakage where the configured RPC (e.g. a
// Helius project key that's been rate-limited or revoked) drops the
// TCP connection mid-request. The browser surfaces that as
// `ERR_CONNECTION_CLOSED` and every read in the dashboard fails with
// no graceful path. The fix is a fallback Connection that retries on
// the always-up public devnet RPC when the primary errors at the
// network layer.
//
// Implementation: Proxy-wrap the primary Connection so any method
// that throws a network-level error retries the same call on a
// fallback Connection. After the first failure we latch - every
// subsequent call goes straight to the fallback so we don't pay the
// primary's timeout on every read.
//
// What this does NOT cover:
//   - WebSocket account subscriptions (web3.js opens a separate WS
//     connection; failures there will just leave the subscription
//     dead until the user reloads). Acceptable for now - reads are
//     the load-bearing path.
//   - Logical RPC errors (account not found, etc.) - those come back
//     as null/empty responses, not exceptions, so the wrapper
//     ignores them.

import { Commitment, Connection, type ConnectionConfig } from "@solana/web3.js";

const DEFAULT_DEVNET_RPC = "https://api.devnet.solana.com";

const alchemyApiKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const ALCHEMY_DEVNET_RPC = alchemyApiKey
  ? `https://solana-devnet.g.alchemy.com/v2/${alchemyApiKey}`
  : null;

/// Per-device localStorage key for the user-set RPC override.
/// Power-user setting - lets a treasury manager point the app at
/// their own paid RPC (Helius, QuickNode, Triton, …) without
/// touching env vars. Only honoured when it's a syntactically
/// valid http(s) URL.
export const RPC_OVERRIDE_STORAGE_KEY = "clear.rpc-override.v1";

function readOverrideFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const v = window.localStorage.getItem(RPC_OVERRIDE_STORAGE_KEY);
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    // Reject anything that isn't HTTPS, except localhost / 127.0.0.1
    // for local development. Plain HTTP RPCs let a passive network
    // observer modify `getBalance` / `getAccountInfo` / `getRecentBlockhash`
    // responses on the wire, manipulating both the balance display the
    // user uses to decide what to import/sweep AND the blockhash that
    // gets baked into the signed tx. That's a big enough lift that we
    // simply don't honour HTTP overrides at all.
    const httpsOk = /^https:\/\/[^\s]+$/i.test(trimmed);
    const localhostOk = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/[^\s]*)?$/i.test(
      trimmed,
    );
    if (httpsOk || localhostOk) return trimmed;
    if (typeof console !== "undefined") {
      console.warn(
        "[solana-rpc] localStorage override rejected. Only https:// or http://localhost are honoured. Falling back to env default.",
      );
    }
    return null;
  } catch {
    return null;
  }
}

/// Default URL - env-driven. Doesn't see the override.
export const solanaClusterDefaultRpc =
  process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
  ALCHEMY_DEVNET_RPC ??
  DEFAULT_DEVNET_RPC;

export const solanaClusterDefaultRpcOrigin = (() => {
  try {
    return new URL(solanaClusterDefaultRpc).origin;
  } catch {
    return DEFAULT_DEVNET_RPC;
  }
})();

/// Effective primary URL: localStorage override (if any) wins,
/// otherwise the env default. Evaluated at module load - the
/// connection singleton built later sees this. Saving a new
/// override after first load requires a page reload to take
/// effect; the Settings UI handles that.
export const solanaClusterRpc =
  readOverrideFromStorage() ?? solanaClusterDefaultRpc;

/// Fallback RPC. Keep this on the same Alchemy devnet endpoint as the
/// default deploy/runtime path so reads and deploy smoke checks do not
/// silently drift back to public Solana RPC.
export const solanaClusterFallbackRpc = DEFAULT_DEVNET_RPC;

/// Build a Connection that transparently fails over to
/// `solanaClusterFallbackRpc` on network errors. Use this everywhere
/// instead of `new Connection(...)` so we keep the resilience
/// contract in one place.
export function createSolanaConnection(
  commitment: Commitment = "confirmed",
): Connection {
  const config: ConnectionConfig = {
    commitment,
    // web3.js logs every 429 retry with console.error. We handle RPC
    // failover ourselves, so disable the internal retry loop and let
    // the proxy below switch providers without noisy console output.
    disableRetryOnRateLimit: true,
  };

  // Same URL? No fallback needed - return a plain Connection.
  if (solanaClusterRpc === solanaClusterFallbackRpc) {
    return new Connection(solanaClusterRpc, config);
  }

  const primary = new Connection(solanaClusterRpc, config);
  let fallback: Connection | null = null;
  let primaryFailed = false;

  const getFallback = (): Connection => {
    if (!fallback) {
      fallback = new Connection(solanaClusterFallbackRpc, config);
    }
    return fallback;
  };

  return new Proxy(primary, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver);
      // Non-function fields go straight through. Connection's RPC
      // methods are all functions; this also keeps Promise-unwrapping,
      // EventEmitter internals, and private `_` fields un-proxied.
      if (typeof original !== "function") return original;

      // If we've already seen the primary fail, dispatch directly to
      // the fallback so we don't pay the primary's timeout every call.
      if (primaryFailed) {
        const fb = getFallback();
        const fbMethod = (fb as unknown as Record<string, unknown>)[
          prop as string
        ];
        if (typeof fbMethod === "function") {
          return (fbMethod as (...a: unknown[]) => unknown).bind(fb);
        }
        return original;
      }

      return async (...args: unknown[]) => {
        try {
          return await (original as (...a: unknown[]) => unknown).apply(
            target,
            args,
          );
        } catch (err) {
          if (!isRecoverableRpcError(err)) throw err;
          // First network failure on the primary. Latch and retry once
          // on the fallback. If the fallback also fails, that error
          // propagates - caller's responsibility.
          if (typeof console !== "undefined") {
            console.warn(
              `[solana-rpc] primary ${solanaClusterRpc} failed, falling back to ${solanaClusterFallbackRpc}`,
              err,
            );
          }
          primaryFailed = true;
          const fb = getFallback();
          const fbMethod = (fb as unknown as Record<string, unknown>)[
            prop as string
          ];
          if (typeof fbMethod !== "function") throw err;
          return await (fbMethod as (...a: unknown[]) => unknown).apply(
            fb,
            args,
          );
        }
      };
    },
  }) as Connection;
}

function isRecoverableRpcError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("rate limit") ||
    msg.includes("failed to fetch") ||
    msg.includes("connection_closed") ||
    msg.includes("err_connection") ||
    msg.includes("err_network") ||
    msg.includes("networkerror") ||
    msg.includes("fetch failed") ||
    msg.includes("typeerror: load failed") || // Safari
    msg.includes("aborted")
  );
}
