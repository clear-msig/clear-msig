"use client";

import { useMemo } from "react";
import { createSolanaConnection } from "@/lib/solana/cluster";
import { useWalletRuntime } from "@/lib/wallet/context";

export function useWallet() {
  return useWalletRuntime();
}

// Single shared Solana connection. Wallet-adapter's ConnectionProvider
// would have given each component an instance via context; we cache one
// at module scope since the RPC URL is static.
let connectionInstance: ReturnType<typeof createSolanaConnection> | null =
  null;

function getSharedConnection() {
  if (connectionInstance === null) {
    connectionInstance = createSolanaConnection("confirmed");
  }
  return connectionInstance;
}

export function useConnection() {
  return useMemo(() => ({ connection: getSharedConnection() }), []);
}
