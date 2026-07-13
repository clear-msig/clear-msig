"use client";

import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

const EMBEDDED_WALLET_CONNECTORS = [TurnkeySolanaWalletConnectors];

export default function EmbeddedDynamicProviderTree({
  environmentId,
  children,
}: {
  environmentId: string;
  children: React.ReactNode;
}) {
  return (
    <DynamicProviderTree
      environmentId={environmentId}
      walletConnectors={EMBEDDED_WALLET_CONNECTORS}
      walletPreference="embedded"
    >
      {children}
    </DynamicProviderTree>
  );
}
