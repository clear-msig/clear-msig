// Root layout . global styles, font tokens, metadata, and providers.
//
// Fonts (retail rebuild, locked 2026-04-30):
//   --font-sans    → Geist, body + UI (Tailwind `font-sans`)
//   --font-display → Fraunces, headlines + display (Tailwind `font-display`)
//   --font-mono    → Geist Mono, code + raw bytes (Tailwind `font-mono`)
//
// next/font locally hosts the webfonts so we hit zero Google-Fonts requests
// at runtime and stay ironclad for offline demos.

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Fraunces } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

const geist = Geist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

const fraunces = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
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
  themeColor: "#16a34a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const fontVars = `${geist.variable} ${fraunces.variable} ${geistMono.variable}`;
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
