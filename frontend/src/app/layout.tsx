// Root layout . global styles, font tokens, metadata, and providers.
//
// Fonts (single-family rebuild 2026-05-03):
//   --font-sans    → Geist, every text surface in the product
//   --font-display → also Geist (alias). The class stays for callers,
//                    but the rendered font is the same; size + weight
//                    do the hierarchy lifting now.
//   --font-mono    → Geist Mono, code + raw bytes (Tailwind `font-mono`)
//
// We retired Fraunces (display serif) on 2026-05-03 because it was
// making a money app read as an editorial site. Cash App, Venmo, Apple
// Wallet, Squads — all sans-only. We follow.

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

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

export const metadata: Metadata = {
  metadataBase: new URL("https://clear-msig.xyz"),
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
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const fontVars = `${geist.variable} ${geistMono.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <head>
        {/* Preconnect to Solana devnet RPC so initial queries shave their DNS+TLS. */}
        <link rel="preconnect" href="https://api.devnet.solana.com" />
        <link rel="dns-prefetch" href="https://api.devnet.solana.com" />
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
