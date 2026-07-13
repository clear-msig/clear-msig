"use client";

import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

// SolanaWalletConnectors already includes injected wallets, legacy Turnkey,
// and Dynamic's V3 SVM WaaS connector. Registering Turnkey again creates a
// duplicate connector key during authentication.
const CONNECT_WALLET_CONNECTORS = [SolanaWalletConnectors];

export default function ConnectDynamicProviderTree({
  environmentId,
  children,
}: {
  environmentId: string;
  children: React.ReactNode;
}) {
  return (
    <DynamicProviderTree
      environmentId={environmentId}
      walletConnectors={CONNECT_WALLET_CONNECTORS}
      walletPreference="primary"
      persistRuntimePreference
    >
      {children}
    </DynamicProviderTree>
  );
}
