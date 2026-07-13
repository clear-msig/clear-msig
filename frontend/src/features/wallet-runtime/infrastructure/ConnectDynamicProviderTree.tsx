"use client";

import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

const CONNECT_WALLET_CONNECTORS = [
  SolanaWalletConnectors,
  TurnkeySolanaWalletConnectors,
];

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
