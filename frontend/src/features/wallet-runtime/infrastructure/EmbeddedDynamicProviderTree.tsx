"use client";

import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { DynamicWaasSVMConnectors } from "@dynamic-labs/waas-svm";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

// V2 users have Turnkey wallets; current Dynamic environments create V3 WaaS
// wallets. Both must remain registered after /connect remounts the lean
// authenticated embedded runtime, otherwise V3 sessions cannot sign.
const EMBEDDED_WALLET_CONNECTORS = [
  TurnkeySolanaWalletConnectors,
  DynamicWaasSVMConnectors,
];

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
