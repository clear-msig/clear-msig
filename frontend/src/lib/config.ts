// Centralized runtime config + production validation.
//
// `defaultWalletName` is intentionally an empty string. Auto-filling
// it to a known wallet name (e.g. "treasury") meant brand-new visitors
// saw on-chain data from a wallet they didn't create - a "default
// transactions" UX bug. Components require the user to explicitly
// choose a wallet, which they can do from /app/wallet's memberships
// card.
//
// Production-readiness contract: every NEXT_PUBLIC_* var that defaults
// to a localhost or missing value MUST be explicitly set on Vercel.
// `validateConfig()` is called once on first render in production and
// surfaces the missing keys as a fatal banner instead of letting the
// app silently call 127.0.0.1.

const IS_PRODUCTION =
  typeof process !== "undefined" && process.env.NODE_ENV === "production";

/// Per-device localStorage key for the user-set EVM destination
/// RPC override. Symmetric with the Solana override in
/// lib/solana/cluster.ts - power users running real volume can
/// point at their own paid RPC (Alchemy, Infura, QuickNode) when
/// the public Sepolia endpoint is rate-limited or down.
export const EVM_RPC_OVERRIDE_STORAGE_KEY = "clear.evm-rpc-override.v1";

function readEvmRpcOverride(): string | null {
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

/// Env-default EVM RPC URL - doesn't see the override. Exposed so
/// the Settings row can tell the user whether the active value is
/// theirs or the env default.
///
/// 1RPC is currently the front of the public-Sepolia pool because it
/// (a) ships permissive CORS for browser origins (blastapi blocks
/// clearsig.xyz, publicnode has been intermittently rate-limiting
/// us with `ERR_CONNECTION_CLOSED`), (b) has the highest free-tier
/// limits of the no-API-key options, and (c) doesn't require an
/// auth header. Rotate via `NEXT_PUBLIC_DESTINATION_RPC_URL` (Vercel
/// env) or the per-device override in Settings.
export const destinationRpcDefault =
  process.env.NEXT_PUBLIC_DESTINATION_RPC_URL ?? "https://1rpc.io/sepolia";

export const hyperliquidRpcDefault =
  process.env.NEXT_PUBLIC_HYPERLIQUID_RPC_URL ?? "https://rpc.hyperliquid.xyz/evm";

export const zcashRpcDefault =
  process.env.NEXT_PUBLIC_ZCASH_RPC_URL ?? "http://127.0.0.1:8232";

export const appConfig = {
  backendApiUrl:
    process.env.NEXT_PUBLIC_BACKEND_API_URL ?? "http://127.0.0.1:8080",
  rampApiUrl:
    process.env.NEXT_PUBLIC_RAMP_API_URL ?? "http://127.0.0.1:8088",
  settlementTreasury: {
    solana:
      process.env.NEXT_PUBLIC_SETTLEMENT_SOL_TREASURY_ADDRESS ??
      process.env.NEXT_PUBLIC_TREASURY_SOL_ADDRESS ??
      "",
  },
  defaultWalletName: "",
  preAlpha: {
    chain: process.env.NEXT_PUBLIC_IKA_CHAIN ?? "evm_1559",
    dwalletProgramId:
      process.env.NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID ??
      "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
    grpcUrl:
      process.env.NEXT_PUBLIC_IKA_GRPC_URL ??
      "https://pre-alpha-dev-1.ika.ika-network.net:443",
    solanaRpcUrl:
      process.env.NEXT_PUBLIC_SOLANA_RPC_URL ??
      "https://api.devnet.solana.com",
    // Effective EVM RPC: localStorage override (if present) wins,
    // otherwise the env default. Evaluated at module load - the
    // singleton callers see this. Saving a new override after first
    // load requires a page reload to take effect; the Settings UI
    // handles that.
    destinationRpcUrl: readEvmRpcOverride() ?? destinationRpcDefault,
    hyperliquidRpcUrl: process.env.NEXT_PUBLIC_HYPERLIQUID_RPC_URL ?? hyperliquidRpcDefault,
    zcashRpcUrl: process.env.NEXT_PUBLIC_ZCASH_RPC_URL ?? zcashRpcDefault,
  },
  dynamicEnvironmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "",
};

export interface ConfigGap {
  envVar: string;
  why: string;
}

/// Returns the list of REQUIRED env vars that aren't set in
/// production. Empty list = good to go. Non-empty = the app should
/// render a "this deployment is misconfigured" banner before any
/// real action, so the failure isn't a silent network call.
///
/// In dev (NODE_ENV !== "production") this returns an empty list
/// regardless - local defaults are fine for hacking on the app.
export function validateConfig(): ConfigGap[] {
  const gaps: ConfigGap[] = [];
  if (!process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID) {
    gaps.push({
      envVar: "NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID",
      why: "Without this, the Dynamic auth widget refuses to mount and users can't sign in. Get one at https://app.dynamic.xyz and add it to .env.local.",
    });
  }
  if (IS_PRODUCTION && !process.env.NEXT_PUBLIC_BACKEND_API_URL) {
    gaps.push({
      envVar: "NEXT_PUBLIC_BACKEND_API_URL",
      why: "Without this, every signed-write call goes to localhost and silently fails.",
    });
  }
  return gaps;
}
