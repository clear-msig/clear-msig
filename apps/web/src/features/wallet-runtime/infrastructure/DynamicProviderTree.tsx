"use client";

// All Dynamic Labs imports + the LedgerProvider live here so they
// can be dynamic-imported as a single chunk. AppProviders pulls
// this component in via next/dynamic({ ssr: false }) - keeping
// every connector package out of the initial layout chunk that
// ships on /privacy, /security, /, etc.
//
// Connector ownership lives in the Embedded, External, and Connect
// wrappers beside this file. Keeping this base connector-agnostic lets
// authenticated routes avoid loading a connector family they cannot use.

import {
  DynamicContextProvider,
  useDynamicContext,
  useUserWallets,
  type DynamicContextProps,
} from "@dynamic-labs/sdk-react-core";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { useEffect, useMemo, useRef } from "react";
import { LedgerProvider } from "@/lib/wallet/LedgerProvider";
import { DynamicWalletRuntimeProvider } from "@/features/wallet-runtime/infrastructure/DynamicWalletRuntimeProvider";
import {
  EXTERNAL_WALLET_RUNTIME_EVENT,
  storeAuthenticatedWalletRuntime,
} from "@/features/wallet-runtime/domain/runtimePreference";
import {
  connectedWalletRuntime,
  type WalletSelectionPreference,
} from "@/lib/wallet/selection";
import { initialAuthFlowDecision } from "@/features/wallet-runtime/domain/initialAuthFlow";

interface Props {
  environmentId: string;
  children: React.ReactNode;
  walletConnectors: DynamicContextProps["settings"]["walletConnectors"];
  walletPreference: WalletSelectionPreference;
  persistRuntimePreference?: boolean;
}

// ── Obsidian & Lime brand override for the Dynamic modal ──────────
// Dynamic renders its auth modal inside a shadow DOM with class
// `.dynamic-shadow-dom`. The SDK exposes ~80 documented CSS custom
// properties (`--dynamic-*`) at that scope; override them and the
// surface picks up the Obsidian & Lime palette without us having to
// fight the SDK's component CSS.
//
// Custom-property inheritance crosses the shadow root, so font
// references like `var(--font-grotesk)` defined on <html> by
// next/font work in here too.
const DYNAMIC_BRAND_CSS =
  ".dynamic-shadow-dom{--dynamic-base-1:#0c0c0c;--dynamic-base-2:rgba(255,255,255,.03);--dynamic-base-3:rgba(255,255,255,.06);--dynamic-background-color:#0c0c0c;--dynamic-border:rgba(255,255,255,.1);--dynamic-border-color:rgba(255,255,255,.1);--dynamic-border-radius:1rem;--dynamic-modal-border:1px solid rgba(255,255,255,.1);--dynamic-modal-backdrop-background:rgba(0,0,0,.72);--dynamic-brand:#cf0;--dynamic-brand-primary-color:#cf0;--dynamic-brand-hover-color:#d8ff33;--dynamic-text-primary:#ebebeb;--dynamic-text-primary-color:#ebebeb;--dynamic-text-secondary:rgba(255,255,255,.6);--dynamic-text-secondary-color:rgba(255,255,255,.6);--dynamic-text-link:#cf0;--dynamic-button-primary-background:#cf0;--dynamic-button-primary-hover:#d8ff33;--dynamic-button-primary-border:1px solid transparent;--dynamic-button-secondary-background:rgba(255,255,255,.03);--dynamic-button-secondary-border:1px solid rgba(255,255,255,.1);--dynamic-connect-button-background:#cf0;--dynamic-connect-button-background-hover:#d8ff33;--dynamic-connect-button-color:#000;--dynamic-connect-button-radius:9999px;--dynamic-wallet-list-tile-background:rgba(255,255,255,.03);--dynamic-wallet-list-tile-background-hover:rgba(204,255,0,.06);--dynamic-wallet-list-tile-border:1px solid rgba(255,255,255,.1);--dynamic-wallet-list-tile-border-hover:1px solid rgba(204,255,0,.4);--dynamic-search-bar-background:rgba(255,255,255,.03);--dynamic-search-bar-border:1px solid rgba(255,255,255,.1);--dynamic-badge-dot-background:#cf0;--dynamic-error-1:#ef4444;--dynamic-success-1:#10b981;--dynamic-alert-1:#f59e0b;--dynamic-font-family-primary:var(--font-grotesk),ui-sans-serif,system-ui,sans-serif;--dynamic-font-family-numbers:var(--font-numerals),ui-monospace,SFMono-Regular,monospace}";

export default function DynamicProviderTree({
  environmentId,
  children,
  walletConnectors,
  walletPreference,
  persistRuntimePreference = false,
}: Props) {
  // Same settings shape and same comments live here as before, just
  // moved out of AppProviders. See the original notes there for
  // why each connector is listed.
  const settings = useMemo<DynamicContextProps["settings"]>(
    () => ({
      environmentId,
      walletConnectors,
      initialAuthenticationMode: "connect-and-sign",
      deviceRegistrationModal: { enabled: false },
      transactionConfirmation: { required: true },
      cssOverrides: DYNAMIC_BRAND_CSS,
    }),
    [environmentId, walletConnectors],
  );

  return (
    <DynamicContextProvider settings={settings}>
      <DynamicPostConnectModalGuard
        persistRuntimePreference={persistRuntimePreference}
      >
        <LedgerProvider>
          <DynamicWalletRuntimeProvider walletPreference={walletPreference}>
            {children}
          </DynamicWalletRuntimeProvider>
        </LedgerProvider>
      </DynamicPostConnectModalGuard>
    </DynamicContextProvider>
  );
}

function DynamicPostConnectModalGuard({
  children,
  persistRuntimePreference,
}: {
  children: React.ReactNode;
  persistRuntimePreference: boolean;
}) {
  const { primaryWallet, sdkHasLoaded, setShowAuthFlow, showAuthFlow } =
    useDynamicContext();
  const wallets = useUserWallets();
  const initialAuthFlowHandled = useRef(false);

  const hasUsableWallet =
    !!primaryWallet || wallets.some((wallet) => wallet && isSolanaWallet(wallet));

  useEffect(() => {
    const decision = initialAuthFlowDecision({
      sdkHasLoaded,
      hasUsableWallet,
      alreadyHandled: initialAuthFlowHandled.current,
      showAuthFlow,
    });
    initialAuthFlowHandled.current = decision.handled;
    if (decision.dismiss) setShowAuthFlow(false);
  }, [hasUsableWallet, sdkHasLoaded, setShowAuthFlow, showAuthFlow]);

  useEffect(() => {
    if (
      !persistRuntimePreference ||
      !sdkHasLoaded ||
      !hasUsableWallet ||
      typeof window === "undefined"
    ) {
      return;
    }
    const runtime = connectedWalletRuntime(primaryWallet, wallets);
    if (storeAuthenticatedWalletRuntime(window.localStorage, runtime)) {
      window.dispatchEvent(new Event(EXTERNAL_WALLET_RUNTIME_EVENT));
    }
  }, [
    hasUsableWallet,
    persistRuntimePreference,
    primaryWallet,
    sdkHasLoaded,
    wallets,
  ]);

  return children;
}
