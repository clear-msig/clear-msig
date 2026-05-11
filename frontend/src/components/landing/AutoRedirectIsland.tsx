"use client";

// Auto-redirect island for the marketing landing page.
//
// `useWalletGate` calls `useWallet` (the Dynamic Labs shim), which in
// turn pulls `@dynamic-labs/sdk-react-core` and
// `@dynamic-labs/solana-core` into whatever module imports it. When
// `/` (the public landing) imported `useWalletGate` directly, the
// bundler couldn't tree-shake those packages out of the landing's
// static chunk. Every first-time marketing visitor downloaded ~700
// kB of Dynamic SDK they didn't need to look at the hero section.
//
// This island isolates the dependency. The landing page renders an
// instance via `next/dynamic({ ssr: false, loading: () => null })`,
// so the SDK ships in a separate async chunk that loads AFTER first
// paint. Authenticated returning users still get auto-routed to
// /app/wallet. Just a few hundred ms later than the eager-import
// version. First-time visitors see the landing fast and never pay
// the cost.
//
// The component renders nothing. It exists purely to host the
// `useWalletGate()` call inside a lazy boundary.

import { useWalletGate } from "@/lib/hooks/useWalletGate";

export default function AutoRedirectIsland() {
  useWalletGate();
  return null;
}
