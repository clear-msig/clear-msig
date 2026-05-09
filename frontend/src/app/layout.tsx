// Root layout . global styles, font tokens, metadata, and providers.
//
// Fonts (editorial-sans rebuild 2026-05-08):
//   --font-sans    → Geist (body). Clean, readable, neutral.
//   --font-display → Manrope (display). Geometric warmth with
//                    distinctive cuts - replaces the previous
//                    Geist alias, which was indistinguishable from
//                    body and gave headlines no character. Manrope
//                    keeps the sans-only money-app rule (Cash App /
//                    Venmo / Apple Wallet are sans-only) while
//                    actually carrying a point of view at display
//                    sizes. font-display class survives unchanged.
//   --font-mono    → Geist Mono (general code + raw bytes).
//   --font-numerals → JetBrains Mono. Used for the big amount
//                    input on /send/* pages - financial numerals
//                    deserve a treatment that reads as precise,
//                    not as "another text field with bigger digits".
//
// 2026-05-03 rebuild dropped Fraunces (display serif) because it
// was making a money app read as an editorial magazine. This
// rebuild keeps the sans-only commitment but escapes generic
// Geist-everywhere by giving display + numerals a real voice.

import type { Metadata, Viewport } from "next";
import {
  Geist,
  Geist_Mono,
  JetBrains_Mono,
  Manrope,
  Space_Grotesk,
} from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";
import { THEME_INIT_SCRIPT } from "@/lib/security/theme-init-script";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

// Variable-axis fonts: omit `weight` so next/font fetches a single
// variable woff2 per family instead of one static file per weight.
// All Tailwind weight classes (font-light/medium/semibold/bold) still
// resolve because the variable font carries the full axis. This drops
// dev-server cold-compile font traffic from ~17 fetches to ~5.
const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-numerals",
});

// Landing + welcome + connect. The Obsidian & Lime design language
// uses Space Grotesk for display + body and JetBrains Mono for
// technical labels. Scoped via `--font-grotesk` so /app/* pages keep
// Geist.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-grotesk",
});

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
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [
      { url: "/apple-icon.svg", type: "image/svg+xml" },
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
  const fontVars = `${geist.variable} ${geistMono.variable} ${manrope.variable} ${jetbrainsMono.variable} ${spaceGrotesk.variable}`;
  return (
    <html lang="en" className={fontVars} suppressHydrationWarning>
      <head>
        {/* Preconnect to Solana devnet RPC so initial queries shave their DNS+TLS. */}
        <link rel="preconnect" href="https://api.devnet.solana.com" />
        <link rel="dns-prefetch" href="https://api.devnet.solana.com" />
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
      <body className="font-sans antialiased">
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
