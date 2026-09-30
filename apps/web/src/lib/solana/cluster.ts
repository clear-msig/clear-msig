// HTTP read failover preserves cluster identity. Never retry submissions or
// wrap synchronous subscription methods, and never silently send a custom
// network request to devnet. WebSocket subscriptions stay on their provider.

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
const storedOverride = readOverrideFromStorage();
export const solanaClusterRpc = storedOverride ?? solanaClusterDefaultRpc;

// A custom per-device RPC must not inherit the deployment's fallback. An
// explicit deployment fallback is permitted only after genesis verification.
export const solanaClusterFallbackRpc = storedOverride ? null
  : process.env.NEXT_PUBLIC_SOLANA_FALLBACK_RPC_URL?.trim() ||
    (!process.env.NEXT_PUBLIC_SOLANA_RPC_URL && ALCHEMY_DEVNET_RPC ? DEFAULT_DEVNET_RPC : null);

const SAFE_READ_METHODS = new Set([
  "getAccountInfo", "getAccountInfoAndContext", "getBalance", "getBalanceAndContext",
  "getMultipleAccountsInfo", "getMultipleAccountsInfoAndContext", "getProgramAccounts",
  "getParsedAccountInfo", "getParsedProgramAccounts", "getParsedTokenAccountsByOwner",
  "getTokenAccountsByOwner", "getTokenAccountBalance", "getTokenSupply", "getSupply",
  "getTransaction", "getParsedTransaction", "getSignaturesForAddress", "getSignatureStatus",
  "getSignatureStatuses", "getLatestBlockhash", "getLatestBlockhashAndContext",
  "isBlockhashValid", "getRecentBlockhash", "getSlot", "getBlockTime", "getBlockHeight",
  "getMinimumBalanceForRentExemption", "getFeeForMessage", "getEpochInfo", "getVersion",
  "getClusterNodes", "getGenesisHash",
]);

export function createSolanaConnection(commitment: Commitment = "confirmed"): Connection {
  const config: ConnectionConfig = { commitment, disableRetryOnRateLimit: true };
  const primary = new Connection(solanaClusterRpc, config);
  const fallback = solanaClusterFallbackRpc && solanaClusterFallbackRpc !== solanaClusterRpc
    ? new Connection(solanaClusterFallbackRpc, config) : null;
  return createReadFallbackConnection(primary, fallback,
    process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim() || undefined);
}

/** Exported for deterministic transport tests; no network or signing at setup. */
export function createReadFallbackConnection(
  primary: Connection,
  fallback: Connection | null,
  expectedGenesis?: string,
): Connection {
  if (!fallback && !expectedGenesis) return primary;
  let primaryGenesis: Promise<string> | null = null;
  let observedGenesis: string | null = null;
  let fallbackVerified: Promise<void> | null = null;
  let primaryFailed = false;
  const identity = () => {
    if (!primaryGenesis) {
      primaryGenesis = primary.getGenesisHash().then((genesis) => {
        if (expectedGenesis && genesis !== expectedGenesis) throw new Error("Configured Solana network identity does not match the RPC.");
        observedGenesis = genesis;
        return genesis;
      }).catch((error) => { primaryGenesis = null; throw error; });
    }
    return primaryGenesis;
  };
  const verifyFallback = () => {
    const required = expectedGenesis ?? observedGenesis;
    if (!fallback || !required) throw new Error("Cannot verify Solana fallback network. Configure its expected genesis identity or restore the primary RPC.");
    if (!fallbackVerified) {
      fallbackVerified = fallback.getGenesisHash().then((genesis) => {
        if (genesis !== required) throw new Error("Solana fallback network does not match the configured primary network.");
      }).catch((error) => { fallbackVerified = null; throw error; });
    }
    return fallbackVerified;
  };
  return new Proxy(primary, {
    get(target, prop) {
      const original = Reflect.get(target, prop, target);
      if (typeof original !== "function") return original;
      // onAccountChange/onSignature return subscription IDs synchronously.
      // Transaction submission is deliberately not retried after ambiguity.
      if (!SAFE_READ_METHODS.has(String(prop))) return original.bind(target);
      return async (...args: unknown[]) => {
        if (!primaryFailed) {
          try {
            const genesis = await identity();
            return prop === "getGenesisHash" ? genesis : await original.apply(target, args);
          } catch (error) {
            if (!fallback || !isRecoverableRpcError(error)) throw error;
            await verifyFallback();
            primaryFailed = true;
            // Endpoints may contain API credentials. Never log their URLs.
            console.warn("[solana-rpc] using a verified same-network read fallback");
          }
        }
        await verifyFallback();
        const method = Reflect.get(fallback!, prop, fallback!);
        return method.apply(fallback, args);
      };
    },
  });
}

function isRecoverableRpcError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof Error && err.name === "AbortError") return false;
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
    msg.includes("typeerror: load failed") // Safari
  );
}
