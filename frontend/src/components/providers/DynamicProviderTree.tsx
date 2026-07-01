"use client";

// All Dynamic Labs imports + the LedgerProvider live here so they
// can be dynamic-imported as a single chunk. AppProviders pulls
// this component in via next/dynamic({ ssr: false }) - keeping
// every connector package out of the initial layout chunk that
// ships on /privacy, /security, /, etc.
//
// 2026-05-21: keep only the embedded Solana connector that signs
// correctly for Clear. Dynamic email / social login still works, but
// the WaaS-SVM connector is intentionally omitted because its
// signMessage path UTF-8-decodes payload bytes and breaks Clear's
// offchain signing envelope.

import {
  DynamicContextProvider,
  useDynamicContext,
  useUserWallets,
  type DynamicContextProps,
} from "@dynamic-labs/sdk-react-core";
import { DynamicWaasEVMConnectors } from "@dynamic-labs/waas-evm";
import { TurnkeySolanaWalletConnectors } from "@dynamic-labs/embedded-wallet-solana";
import { SolanaWalletConnectors } from "@dynamic-labs/solana";
import { isSolanaWallet } from "@dynamic-labs/solana-core";
import { useEffect } from "react";
import { LedgerProvider } from "@/lib/wallet/LedgerProvider";
import { DynamicWalletRuntimeProvider } from "@/lib/wallet/dynamic";

interface Props {
  environmentId: string;
  children: React.ReactNode;
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
const DYNAMIC_BRAND_CSS = `
.dynamic-shadow-dom {
  /* surfaces */
  --dynamic-base-1: #0c0c0c;
  --dynamic-base-2: rgba(255, 255, 255, 0.03);
  --dynamic-base-3: rgba(255, 255, 255, 0.06);
  --dynamic-base-4: rgba(255, 255, 255, 0.12);
  --dynamic-base-white: #ffffff;
  --dynamic-background-color: #0c0c0c;
  --dynamic-background-disabled-color: rgba(255, 255, 255, 0.03);
  --dynamic-overlay: rgba(0, 0, 0, 0.6);
  --dynamic-hover: rgba(255, 255, 255, 0.05);

  /* borders + radii */
  --dynamic-border: rgba(255, 255, 255, 0.1);
  --dynamic-border-1: rgba(255, 255, 255, 0.1);
  --dynamic-border-2: rgba(255, 255, 255, 0.16);
  --dynamic-border-color: rgba(255, 255, 255, 0.1);
  --dynamic-border-radius: 1rem;

  /* modal chrome */
  --dynamic-modal-border: 1px solid rgba(255, 255, 255, 0.1);
  --dynamic-modal-backdrop-background: rgba(0, 0, 0, 0.72);
  --dynamic-modal-backdrop-filter: blur(8px);

  /* brand - lime + emerald */
  --dynamic-brand: #ccff00;
  --dynamic-brand-dark: #a8d600;
  --dynamic-brand-primary-color: #ccff00;
  --dynamic-brand-primary-color-10: rgba(204, 255, 0, 0.1);
  --dynamic-brand-secondary-color: #10b981;
  --dynamic-brand-hover-color: #d8ff33;

  /* text */
  --dynamic-text-primary: #ebebeb;
  --dynamic-text-primary-color: #ebebeb;
  --dynamic-text-secondary: rgba(255, 255, 255, 0.6);
  --dynamic-text-secondary-color: rgba(255, 255, 255, 0.6);
  --dynamic-text-tertiary: rgba(255, 255, 255, 0.4);
  --dynamic-text-white: #ffffff;
  --dynamic-text-link: #ccff00;

  /* primary button (lime CTA) */
  --dynamic-button-primary-background: #ccff00;
  --dynamic-button-primary-hover: #d8ff33;
  --dynamic-button-primary-border: 1px solid transparent;
  --dynamic-button-shadow: 0 0 24px rgba(204, 255, 0, 0.25);

  /* secondary button (glass) */
  --dynamic-button-secondary-background: rgba(255, 255, 255, 0.03);
  --dynamic-button-secondary-hover: rgba(255, 255, 255, 0.08);
  --dynamic-button-secondary-border: 1px solid rgba(255, 255, 255, 0.1);

  /* connect button (also lime) */
  --dynamic-connect-button-background: #ccff00;
  --dynamic-connect-button-background-hover: #d8ff33;
  --dynamic-connect-button-color: #000000;
  --dynamic-connect-button-color-hover: #000000;
  --dynamic-connect-button-border: 1px solid transparent;
  --dynamic-connect-button-border-hover: 1px solid transparent;
  --dynamic-connect-button-radius: 9999px;
  --dynamic-connect-button-shadow: 0 0 24px rgba(204, 255, 0, 0.25);
  --dynamic-connect-button-shadow-hover: 0 0 32px rgba(204, 255, 0, 0.4);

  /* wallet list tiles - glass with lime hover */
  --dynamic-wallet-list-tile-background: rgba(255, 255, 255, 0.03);
  --dynamic-wallet-list-tile-background-hover: rgba(204, 255, 0, 0.06);
  --dynamic-wallet-list-tile-border: 1px solid rgba(255, 255, 255, 0.1);
  --dynamic-wallet-list-tile-border-hover: 1px solid rgba(204, 255, 0, 0.4);
  --dynamic-wallet-list-tile-shadow: none;
  --dynamic-wallet-list-tile-shadow-hover: 0 0 18px rgba(204, 255, 0, 0.15);

  /* search bar */
  --dynamic-search-bar-background: rgba(255, 255, 255, 0.03);
  --dynamic-search-bar-background-focus: rgba(255, 255, 255, 0.05);
  --dynamic-search-bar-background-hover: rgba(255, 255, 255, 0.04);
  --dynamic-search-bar-border: 1px solid rgba(255, 255, 255, 0.1);
  --dynamic-search-bar-border-focus: 1px solid rgba(204, 255, 0, 0.5);
  --dynamic-search-bar-border-hover: 1px solid rgba(255, 255, 255, 0.2);

  /* header / footer */
  --dynamic-header-background: transparent;
  --dynamic-header-border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  --dynamic-footer-background: transparent;
  --dynamic-footer-background-color: transparent;
  --dynamic-footer-border-top: 1px solid rgba(255, 255, 255, 0.08);
  --dynamic-footer-text-color: rgba(255, 255, 255, 0.5);
  --dynamic-footer-icon-color: rgba(255, 255, 255, 0.5);
  --dynamic-footer-arrow-color: rgba(255, 255, 255, 0.5);

  /* badges + alerts */
  --dynamic-badge-background: rgba(255, 255, 255, 0.05);
  --dynamic-badge-color: rgba(255, 255, 255, 0.7);
  --dynamic-badge-dot-background: #ccff00;
  --dynamic-badge-primary-background: rgba(204, 255, 0, 0.12);
  --dynamic-badge-primary-color: #ccff00;
  --dynamic-error-1: #ef4444;
  --dynamic-error-2: rgba(239, 68, 68, 0.15);
  --dynamic-red-2: rgba(239, 68, 68, 0.15);
  --dynamic-success-1: #10b981;
  --dynamic-success-2: rgba(16, 185, 129, 0.15);
  --dynamic-alert-1: #f59e0b;
  --dynamic-alert-2: rgba(245, 158, 11, 0.15);
  --dynamic-info-2: rgba(204, 255, 0, 0.12);

  /* shadows */
  --dynamic-shadow-down-1: 0 4px 12px rgba(0, 0, 0, 0.45);
  --dynamic-shadow-down-2: 0 8px 24px rgba(0, 0, 0, 0.55);
  --dynamic-shadow-down-3: 0 16px 48px rgba(0, 0, 0, 0.6);
  --dynamic-shadow-up-1: 0 -4px 16px rgba(0, 0, 0, 0.4);

  /* tooltip */
  --dynamic-tooltip-color: #0c0c0c;
  --dynamic-tooltip-text-color: #ebebeb;

  /* loading shimmer */
  --dynamic-loading-animation-gradient: linear-gradient(
    90deg,
    transparent 0%,
    rgba(204, 255, 0, 0.18) 50%,
    transparent 100%
  );

  /* fonts - inherit our brand stack from <html>. Custom properties
     cross the shadow boundary, so var(--font-grotesk) resolves. */
  --dynamic-font-family-primary: var(--font-grotesk), ui-sans-serif,
    system-ui, sans-serif;
  --dynamic-font-family-mono: var(--font-numerals), ui-monospace,
    SFMono-Regular, monospace;
  --dynamic-font-family-numbers: var(--font-numerals), ui-monospace,
    SFMono-Regular, monospace;
}
`;

export default function DynamicProviderTree({ environmentId, children }: Props) {
  // Same settings shape and same comments live here as before, just
  // moved out of AppProviders. See the original notes there for
  // why each connector is listed.
  const settings: DynamicContextProps["settings"] = {
    environmentId,
    walletConnectors: [
      SolanaWalletConnectors,
      TurnkeySolanaWalletConnectors,
      DynamicWaasEVMConnectors,
    ],
    initialAuthenticationMode: "connect-and-sign",
    deviceRegistrationModal: { enabled: false },
    // The cssOverrides string remaps every load-bearing
    // `--dynamic-*` token to the Obsidian & Lime palette directly,
    // so we don't need to ask the SDK to swap to its built-in
    // dark theme first. (`theme` isn't in the public settings type
    // anyway.)
    cssOverrides: DYNAMIC_BRAND_CSS,
  };

  return (
    <DynamicContextProvider settings={settings}>
      <DynamicPostConnectModalGuard>
        <LedgerProvider>
          <DynamicWalletRuntimeProvider>{children}</DynamicWalletRuntimeProvider>
        </LedgerProvider>
      </DynamicPostConnectModalGuard>
    </DynamicContextProvider>
  );
}

function DynamicPostConnectModalGuard({
  children,
}: {
  children: React.ReactNode;
}) {
  const { primaryWallet, sdkHasLoaded, setShowAuthFlow, showAuthFlow } =
    useDynamicContext();
  const wallets = useUserWallets();

  const hasUsableWallet =
    !!primaryWallet || wallets.some((wallet) => wallet && isSolanaWallet(wallet));

  useEffect(() => {
    if (!sdkHasLoaded || !showAuthFlow || !hasUsableWallet) return;
    setShowAuthFlow(false);
    // Mobile webviews can re-open Dynamic's auth portal one tick after
    // wallet hydration. Close it once immediately, then once more after
    // the SDK has finished its post-connect bookkeeping.
    const closeAgain = window.setTimeout(() => setShowAuthFlow(false), 250);
    return () => window.clearTimeout(closeAgain);
  }, [hasUsableWallet, sdkHasLoaded, setShowAuthFlow, showAuthFlow]);

  return children;
}
