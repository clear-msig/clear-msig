"use client";

// All Dynamic Labs imports + the LedgerProvider live here so they
// can be dynamic-imported as a single chunk. AppProviders pulls
// this component in via next/dynamic({ ssr: false }) — keeping
// every connector package out of the initial layout chunk that
// ships on /privacy, /security, /, etc.
//
// 2026-05-08: dropped WaaS-EVM and WaaS-Sui connectors. clear-msig's
// user-facing chain is Solana — ETH/BTC/Zcash transfers are signed
// by the user's existing Solana key via Ika dWallets, so users never
// connect with an EVM account. Sui isn't a destination chain at all.
// Removing the two unused connector packages trims hundreds of KB
// off the chunk that gates /welcome and /connect rendering.

import {
  DynamicContextProvider,
  type DynamicContextProps,
} from "@dynamic-labs/sdk-react-core";
import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { DynamicWaasSVMConnectors } from "@dynamic-labs/waas-svm";
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
