"use client";

import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

const EXTERNAL_WALLET_CONNECTORS = [
  SolanaWalletConnectors,
  TurnkeySolanaWalletConnectors,
];

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
      rememberExternalWallet
    >
      {children}
    </DynamicProviderTree>
  );
}
