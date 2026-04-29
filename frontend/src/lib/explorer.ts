// Solana Explorer URL helpers.
//
// Cluster comes from NEXT_PUBLIC_SOLANA_RPC_URL — devnet for the current
// pre-alpha deployment. Mainnet links would drop the ?cluster= suffix.
// We default to devnet to match the rest of the app's deployment.

const CLUSTER_QS =
  (process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "").includes("devnet")
    ? "?cluster=devnet"
    : "";

const BASE = "https://explorer.solana.com";

export function txUrl(signature: string): string {
  return `${BASE}/tx/${signature}${CLUSTER_QS}`;
}

export function addressUrl(address: string): string {
  return `${BASE}/address/${address}${CLUSTER_QS}`;
}
