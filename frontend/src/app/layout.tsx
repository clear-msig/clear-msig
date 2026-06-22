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
import "@fontsource/montserrat/300.css";
import "@fontsource/montserrat/400.css";
import "@fontsource/montserrat/500.css";
import "@fontsource/montserrat/600.css";
import "@fontsource/montserrat/700.css";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { THEME_INIT_SCRIPT } from "@/lib/security/theme-init-script";
import { solanaClusterDefaultRpcOrigin } from "@/lib/solana/cluster";

export const metadata: Metadata = {
  metadataBase: new URL("https://clearsig.xyz"),
  title: {
    default: "Clear · Send money with people you trust",
    template: "%s · Clear",
  },
  description:
    "A shared wallet for friends, family, or your team. Everyone sees the request, anyone can approve, and nobody has to handle keys alone.",
  keywords: [
    "shared wallet",
    "send money",
    "split a wallet",
    "group wallet",
    "family wallet",
  ],
  applicationName: "Clear",
  authors: [{ name: "Clear" }],
  openGraph: {
    type: "website",
    title: "Clear · Send money with people you trust",
    description:
      "A shared wallet for friends, family, or your team. Everyone sees the request, anyone can approve.",
    siteName: "Clear",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clear · Send money with people you trust",
    description:
      "A shared wallet for friends, family, or your team. Everyone sees the request.",
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/clearmark-light.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/clearmark-light.svg", type: "image/svg+xml" },
    ],
  },
};

export const viewport: Viewport = {
  // Brand lime - drives the iOS Safari address-bar tint and the
  // Android Chrome status bar. The previous #16a34a was the legacy
  // brand-green from before the Obsidian & Lime pivot (2026-05-08).
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
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }}
        />
      </head>
      <body className="clear-ui-root font-sans antialiased">
        <AppProviders>{children}</AppProviders>
        {/* Vercel Analytics removed: the bundled <Analytics /> component
            requests /_vercel/insights/script.js which 404s unless Web
            Analytics is explicitly enabled on the Vercel project. To
            re-enable: turn on Analytics in the Vercel project settings,
            then re-add `import { Analytics } from "@vercel/analytics/react"`
            and `<Analytics />` here. */}
      </body>
    </html>
  );
}
