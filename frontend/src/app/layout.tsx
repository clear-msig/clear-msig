// Root layout . global styles, font tokens, metadata, and providers.
//
// Fonts (editorial-sans rebuild 2026-05-08):
//   --font-sans    → Geist (body). Clean, readable, neutral.
//   --font-display → Manrope (display). Geometric warmth with
//                    distinctive cuts — replaces the previous
//                    Geist alias, which was indistinguishable from
//                    body and gave headlines no character. Manrope
//                    keeps the sans-only money-app rule (Cash App /
//                    Venmo / Apple Wallet are sans-only) while
//                    actually carrying a point of view at display
//                    sizes. font-display class survives unchanged.
//   --font-mono    → Geist Mono (general code + raw bytes).
//   --font-numerals → JetBrains Mono. Used for the big amount
//                    input on /send/* pages — financial numerals
//                    deserve a treatment that reads as precise,
//                    not as "another text field with bigger digits".
//
// 2026-05-03 rebuild dropped Fraunces (display serif) because it
// was making a money app read as an editorial magazine. This
// rebuild keeps the sans-only commitment but escapes generic
// Geist-everywhere by giving display + numerals a real voice.

import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, JetBrains_Mono, Manrope } from "next/font/google";
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

const manrope = Manrope({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  // 700 + 800 cover the display-weight ladder; 500 is the only
  // body weight any Manrope call site uses (font-display.font-medium).
  weight: ["500", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-numerals",
  weight: ["500", "600", "700"],
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
  const fontVars = `${geist.variable} ${geistMono.variable} ${manrope.variable} ${jetbrainsMono.variable}`;
  return (
    <html lang="en" className={fontVars}>
      <head>
        {/* Preconnect to Solana devnet RPC so initial queries shave their DNS+TLS. */}
        <link rel="preconnect" href="https://api.devnet.solana.com" />
        <link rel="dns-prefetch" href="https://api.devnet.solana.com" />
        {/* Theme bootstrap — runs synchronously BEFORE first paint
            so a user with the dark preference doesn't see a flash
            of light page. Reads localStorage["clear.theme.v1"] and
            sets data-theme on <html>. Inline script (not a
            <Script> tag) so it runs before React hydrates. */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('clear.theme.v1');if(t!=='light'&&t!=='dark'&&t!=='system')t='system';document.documentElement.setAttribute('data-theme',t);}catch(_){document.documentElement.setAttribute('data-theme','system');}})();`,
          }}
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
