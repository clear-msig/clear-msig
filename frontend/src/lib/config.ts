// Centralized runtime config to keep environment handling consistent.
//
// `defaultWalletName` is intentionally an empty string by default. Auto-
// filling it to a known wallet name (e.g. "treasury") meant brand-new
// visitors saw on-chain data from a wallet they didn't create — a
// "default transactions" UX bug. Components now require the user to
// explicitly choose a wallet, which they can do from /app/wallet's
// memberships card.
export const appConfig = {
  backendApiUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL ?? "http://127.0.0.1:8080",
  // Hardcoded to "" — the env var was previously used to seed forms with
  // a known wallet name on devnet, which leaked someone-else's data into
  // a fresh user's UI. Reading the env var here is intentionally dropped.
  defaultWalletName: "",
  preAlpha: {
    chain: process.env.NEXT_PUBLIC_IKA_CHAIN ?? "evm_1559",
    dwalletProgramId: process.env.NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID ?? "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
    grpcUrl: process.env.NEXT_PUBLIC_IKA_GRPC_URL ?? "https://pre-alpha-dev-1.ika.ika-network.net:443",
    solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    destinationRpcUrl: process.env.NEXT_PUBLIC_DESTINATION_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
  }
};
