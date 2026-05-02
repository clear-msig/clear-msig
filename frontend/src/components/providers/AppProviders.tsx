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
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import { ToastProvider } from "@/components/ui/Toast";
import { validateConfig } from "@/lib/config";
import { LedgerProvider } from "@/lib/wallet/LedgerProvider";

type Props = {
  children: React.ReactNode;
};

export function AppProviders({ children }: Props) {
  const configGaps = validateConfig();
  if (configGaps.length > 0) {
    return <ConfigGapBanner gaps={configGaps} />;
  }
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
      // External Solana wallets (Phantom / Solflare / Backpack /
      // Coinbase Wallet) — wallet-standard auto-discovery. Without
      // this connector explicitly listed, Dynamic's widget hides
      // the "Connect wallet" option even when the dashboard has
      // external wallets enabled.
      SolanaWalletConnectors,
      // Embedded Solana wallets (TSS-MPC + Turnkey) — for the
      // email/social signup path that mints a wallet on the fly.
      DynamicWaasSVMConnectors,
      TurnkeySolanaWalletConnectors,
      // EVM + Sui WaaS — Dynamic mints embedded wallets on every
      // chain enabled in the project's Embedded Wallets settings,
      // and throws on init if it cannot find the matching connector.
      DynamicWaasEVMConnectors,
      DynamicWaasSuiConnectors,
    ],
  };

  return (
    <QueryClientProvider client={queryClient}>
      <DynamicContextProvider settings={settings}>
        <LedgerProvider>
          <ToastProvider>{children}</ToastProvider>
        </LedgerProvider>
      </DynamicContextProvider>
    </QueryClientProvider>
  );
}

// ─── Production misconfiguration screen ───────────────────────────
//
// When a NEXT_PUBLIC_ var the production deploy depends on is
// missing, the silent failure mode (calls to localhost, an empty
// Dynamic widget) is much worse than a fatal banner. This screen
// ships in place of the app and lists exactly what's missing + why.
// Renders only in NODE_ENV === "production"; dev hacking is unaffected.

function ConfigGapBanner({
  gaps,
}: {
  gaps: ReturnType<typeof validateConfig>;
}) {
  return (
    <main className="min-h-screen bg-canvas px-gutter py-12">
      <div className="mx-auto max-w-xl rounded-card border border-danger/40 bg-danger/[0.05] p-6">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-danger">
          This deployment is misconfigured
        </p>
        <h1 className="mt-2 font-display text-display-xs text-text-strong">
          {gaps.length === 1 ? "1 environment variable" : `${gaps.length} environment variables`}{" "}
          missing
        </h1>
        <p className="mt-2 text-sm text-text-soft">
          The production build started without the required configuration.
          Set the variables below in the Vercel project settings and
          redeploy.
        </p>
        <ul className="mt-4 flex flex-col gap-3">
          {gaps.map((g) => (
            <li
              key={g.envVar}
              className="rounded-soft border border-border-soft bg-surface-raised p-3"
            >
              <code className="font-mono text-sm font-medium text-text-strong">
                {g.envVar}
              </code>
              <p className="mt-1 text-xs text-text-soft">{g.why}</p>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
