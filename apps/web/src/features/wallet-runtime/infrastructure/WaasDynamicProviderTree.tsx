"use client";

import { DynamicWaasSVMConnectors } from "@dynamic-labs/waas-svm";
import DynamicProviderTree from "@/features/wallet-runtime/infrastructure/DynamicProviderTree";

const WAAS_WALLET_CONNECTORS = [DynamicWaasSVMConnectors];

export default function WaasDynamicProviderTree({
  environmentId,
  children,
}: {
  environmentId: string;
  children: React.ReactNode;
}) {
  return (
    <DynamicProviderTree
      environmentId={environmentId}
      walletConnectors={WAAS_WALLET_CONNECTORS}
      walletPreference="embedded"
    >
      {children}
    </DynamicProviderTree>
  );
}
