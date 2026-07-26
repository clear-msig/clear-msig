"use client";

import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

const EXTERNAL_WALLET_CONNECTORS = [SolanaWalletConnectors];

export default function ExternalDynamicProviderTree({
  environmentId,
  children,
}: {
  environmentId: string;
  children: React.ReactNode;
}) {
  return (
    <DynamicProviderTree
      environmentId={environmentId}
      walletConnectors={EXTERNAL_WALLET_CONNECTORS}
      walletPreference="external"
    >
      {children}
    </DynamicProviderTree>
  );
}
