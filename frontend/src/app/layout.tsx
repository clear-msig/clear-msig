// Root layout . global styles, font tokens, metadata, and providers.
//
// Font tokens are defined in globals.css with system stacks. Avoid
// next/font/google here: production builds must not depend on fetching
// fonts.googleapis.com.
//
// 2026-05-03 rebuild dropped Fraunces (display serif) because it
// was making a money app read as an editorial magazine. This
// rebuild keeps the sans-only commitment but escapes generic
// Geist-everywhere by giving display + numerals a real voice.

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { THEME_INIT_SCRIPT } from "@/lib/security/theme-init-script";
import { solanaClusterDefaultRpcOrigin } from "@/lib/solana/cluster";
import { siteMetadata } from "@/lib/metadata/site";
import { Analytics } from "@vercel/analytics/next";

export const metadata: Metadata = siteMetadata;

export const viewport: Viewport = {
  // Brand lime drives the iOS Safari address-bar tint and the
  // Android Chrome status bar.
  themeColor: "#ccff00",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Preconnect to the configured Solana RPC so initial queries shave their DNS+TLS. */}
        <link rel="preconnect" href={solanaClusterDefaultRpcOrigin} />
        <link rel="dns-prefetch" href={solanaClusterDefaultRpcOrigin} />
        {/* Theme bootstrap - runs SYNCHRONOUSLY before paint to set
            the right `data-theme` attribute. Without this, users
            with stored "light" preference would see a dark flash
            for 1-2 frames while React hydrates. suppressHydrationWarning
            on <html> lets the script-applied attribute differ from
            SSR's deterministic markup without a React 19 mismatch. */}
        <script
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="clear-ui-root font-sans antialiased">
        <AppProviders>{children}</AppProviders>
        <Analytics />
      </body>
    </html>
  );
}
