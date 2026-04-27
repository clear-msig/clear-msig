// Root layout . global styles, font tokens, metadata, and providers.
//
// Fonts:
//   --font-inter   → body sans (--font-inter, matches tailwind `font-sans`)
//   --font-display → Space Grotesk, hero/display headlines (`font-display`)
//   --font-mono    → JetBrains Mono, hex + address previews (`font-mono`)
//
// next/font locally hosts the webfonts so we hit zero Google-Fonts requests
// at runtime and stay ironclad for offline demos.

import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./globals.css";
import { AppProviders } from "@/components/providers/AppProviders";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://clear-msig.xyz"),
  title: {
    default: "Clear-MSIG · Sign intents, not hex",
    template: "%s · Clear-MSIG",
  },
  description:
    "A Solana multisig where every signature is a sentence your Ledger can read. One policy controls Ethereum, Bitcoin, and Solana treasuries via Ika dWallets.",
  keywords: [
    "Solana multisig",
    "clear signing",
    "intent signing",
    "Ika dWallet",
    "cross-chain custody",
    "MPC wallet",
    "Quasar",
  ],
  applicationName: "Clear-MSIG",
  authors: [{ name: "Clear-MSIG" }],
  openGraph: {
    type: "website",
    title: "Clear-MSIG · Sign intents, not hex",
    description:
      "Solana multisig with clear-signed, human-readable intents. One policy drives Ethereum, Bitcoin, and Solana via Ika MPC dWallets.",
    siteName: "Clear-MSIG",
  },
  twitter: {
    card: "summary_large_image",
    title: "Clear-MSIG · Sign intents, not hex",
    description:
      "Solana multisig with human-readable signatures. Cross-chain custody via Ika dWallets.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  themeColor: "#14F195",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const fontVars = `${inter.variable} ${spaceGrotesk.variable} ${jetBrainsMono.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <head>
        {/* Preconnect to Solana devnet RPC so initial queries shave their DNS+TLS. */}
        <link rel="preconnect" href="https://api.devnet.solana.com" />
        <link rel="dns-prefetch" href="https://api.devnet.solana.com" />
      </head>
      <body className="font-sans antialiased">
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
