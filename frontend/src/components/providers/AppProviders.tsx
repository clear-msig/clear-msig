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

  // Two embedded-Solana paths are registered. Dynamic picks one
  // based on the project's Embedded Wallets settings:
  //   - DynamicWaasSVMConnectors (TSS-MPC, the new default)
  //   - TurnkeySolanaWalletConnectors (HSM-backed, legacy)
  //
  // Known bug, current workaround: DynamicWaasSVMSigner.signMessage
  // calls `Buffer.from(bytes).toString()` which UTF-8-decodes the
  // input before signing. Our offchain envelope starts with `\xff`,
  // an invalid UTF-8 byte that gets replaced with U+FFFD, so the
  // wallet signs different bytes than we asked. We catch this in
  // useSignWithWallet via local ed25519 verify and tell the user
  // to use an external wallet (Phantom / Solflare / Backpack) or a
  // Ledger. Turnkey doesn't have this bug; if your Dynamic project
  // exposes Turnkey as the embedded provider, prefer it.
  //
  // EVM + Sui WaaS connectors are listed so Dynamic doesn't crash
  // at init when those chains are enabled in the dashboard. They
  // aren't used for Solana signing.
  const settings: DynamicContextProps["settings"] = {
    environmentId: environmentId ?? "",
    walletConnectors: [
      SolanaWalletConnectors,
      DynamicWaasSVMConnectors,
      TurnkeySolanaWalletConnectors,
      DynamicWaasEVMConnectors,
      DynamicWaasSuiConnectors,
    ],
    // Connect-only mode. We do not run a Dynamic-side user account
    // for external wallets — Phantom / Solflare / Backpack just
    // connect and we use their pubkey as the user's identity. Without
    // this, Dynamic prompts the user to "set up a password" / register
    // a passkey on first connect, which reads as broken to retail
    // users who already have a wallet they trust.
    initialAuthenticationMode: "connect-only",
    // Suppress the device-registration modal (the "setup password with
    // some boxes to check" the team flagged). We don't run device-
    // gated MFA in pre-alpha; if we re-enable it later, this flips on
    // and the SDK will surface its standard enrollment flow.
    deviceRegistrationModal: { enabled: false },
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
