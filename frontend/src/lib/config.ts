// Centralized runtime config + production validation.
//
// `defaultWalletName` is intentionally an empty string. Auto-filling
// it to a known wallet name (e.g. "treasury") meant brand-new visitors
// saw on-chain data from a wallet they didn't create — a "default
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

export const appConfig = {
  backendApiUrl:
    process.env.NEXT_PUBLIC_BACKEND_API_URL ?? "http://127.0.0.1:8080",
  rampApiUrl:
    process.env.NEXT_PUBLIC_RAMP_API_URL ?? "http://127.0.0.1:8088",
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
    destinationRpcUrl:
      process.env.NEXT_PUBLIC_DESTINATION_RPC_URL ??
      "https://ethereum-sepolia-rpc.publicnode.com",
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
/// regardless — local defaults are fine for hacking on the app.
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
