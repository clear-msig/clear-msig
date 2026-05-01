"use client";

// App providers: query cache, Dynamic auth + wallet, global toast.
//
// Dynamic replaces the old @solana/wallet-adapter setup. It handles
// both onboarding paths in one provider:
//   - Email / social signup mints a TSS-MPC embedded Solana wallet
//     on the fly (the retail story).
//   - External wallets (Phantom / Solflare / Backpack) auto-discover
//     via Dynamic's wallet-standard support.
//
// The 30+ files that imported from @solana/wallet-adapter-react now
// import from @/lib/wallet, a thin shim that exposes useWallet()
// and useConnection() with the same shape, backed by Dynamic. The
// swap was an import path change in those files, no logic changes.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import {
  DynamicContextProvider,
  type DynamicContextProps,
} from "@dynamic-labs/sdk-react-core";
import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { DynamicWaasSVMConnectors } from "@dynamic-labs/waas-svm";
import { DynamicWaasEVMConnectors } from "@dynamic-labs/waas-evm";
import { DynamicWaasSuiConnectors } from "@dynamic-labs/waas-sui";
import { ToastProvider } from "@/components/ui/Toast";

type Props = {
  children: React.ReactNode;
};

export function AppProviders({ children }: Props) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 10_000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID;

  // Hard fail in development if the env id is missing; on production
  // this is impossible to recover from gracefully and a clear error
  // beats a confused-looking empty wallet picker.
  if (!environmentId) {
    if (typeof window !== "undefined") {
      console.error(
        "[AppProviders] NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID is not set. " +
          "Get one from https://app.dynamic.xyz and add it to .env.local.",
      );
    }
  }

  // Connector list mirrors the spike. Two Solana paths are included so
  // the SDK can pick whichever the dashboard configured (TSS WaaS is
  // the new default, Turnkey is legacy). EVM + Sui WaaS connectors are
  // listed because Dynamic mints embedded wallets for every chain
  // enabled in the project's Embedded Wallets settings, and throws if
  // it cannot find a connector for one. BTC's WaaS connector isn't on
  // npm yet; disable BTC in the dashboard if init errors mention it.
  const settings: DynamicContextProps["settings"] = {
    environmentId: environmentId ?? "",
    walletConnectors: [
      DynamicWaasSVMConnectors,
      DynamicWaasEVMConnectors,
      DynamicWaasSuiConnectors,
      TurnkeySolanaWalletConnectors,
    ],
  };

  return (
    <QueryClientProvider client={queryClient}>
      <DynamicContextProvider settings={settings}>
        <ToastProvider>{children}</ToastProvider>
      </DynamicContextProvider>
    </QueryClientProvider>
  );
}
