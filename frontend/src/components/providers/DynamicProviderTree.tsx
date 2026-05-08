"use client";

// All Dynamic Labs imports + the LedgerProvider live here so they
// can be dynamic-imported as a single chunk. AppProviders pulls
// this component in via next/dynamic({ ssr: false }) — keeping
// every connector package out of the initial layout chunk that
// ships on /privacy, /security, /, etc.
//
// The cost: a thin "Connecting…" shell flashes for ~one frame
// while the chunk hydrates. Worth it: the 5 connector packages
// (Turnkey, WaaS-SVM/EVM/Sui, vanilla Solana) are the heaviest
// shared dependency in the app.

import {
  DynamicContextProvider,
  type DynamicContextProps,
} from "@dynamic-labs/sdk-react-core";
import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { DynamicWaasSVMConnectors } from "@dynamic-labs/waas-svm";
import { DynamicWaasEVMConnectors } from "@dynamic-labs/waas-evm";
import { DynamicWaasSuiConnectors } from "@dynamic-labs/waas-sui";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import { LedgerProvider } from "@/lib/wallet/LedgerProvider";

interface Props {
  environmentId: string;
  children: React.ReactNode;
}

export default function DynamicProviderTree({ environmentId, children }: Props) {
  // Same settings shape and same comments live here as before, just
  // moved out of AppProviders. See the original notes there for
  // why each connector is listed.
  const settings: DynamicContextProps["settings"] = {
    environmentId,
    walletConnectors: [
      SolanaWalletConnectors,
      DynamicWaasSVMConnectors,
      TurnkeySolanaWalletConnectors,
      DynamicWaasEVMConnectors,
      DynamicWaasSuiConnectors,
    ],
    initialAuthenticationMode: "connect-only",
    deviceRegistrationModal: { enabled: false },
  };

  return (
    <DynamicContextProvider settings={settings}>
      <LedgerProvider>{children}</LedgerProvider>
    </DynamicContextProvider>
  );
}
