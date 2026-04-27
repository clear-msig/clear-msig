// Centralized runtime config to keep environment handling consistent.
export const appConfig = {
  backendApiUrl: process.env.NEXT_PUBLIC_BACKEND_API_URL ?? "http://127.0.0.1:8080",
  defaultWalletName: process.env.NEXT_PUBLIC_DEFAULT_WALLET_NAME ?? "treasury",
  preAlpha: {
    chain: process.env.NEXT_PUBLIC_IKA_CHAIN ?? "evm_1559",
    dwalletProgramId: process.env.NEXT_PUBLIC_IKA_DWALLET_PROGRAM_ID ?? "87W54kGYFQ1rgWqMeu4XTPHWXWmXSQCcjm8vCTfiq1oY",
    grpcUrl: process.env.NEXT_PUBLIC_IKA_GRPC_URL ?? "https://pre-alpha-dev-1.ika.ika-network.net:443",
    solanaRpcUrl: process.env.NEXT_PUBLIC_SOLANA_RPC_URL ?? "https://api.devnet.solana.com",
    destinationRpcUrl: process.env.NEXT_PUBLIC_DESTINATION_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com"
  }
};
