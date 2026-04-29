// PWA manifest for "add to home screen" support on mobile.
//
// Standalone display mode means iOS/Android home-screen launches open
// the site without browser chrome. Combined with the apple-icon and
// icon files in this directory it behaves like a native shell.

import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Clear-MSIG",
    short_name: "Clear-MSIG",
    description:
      "Solana multisig with clear-signed, human-readable intents. One policy, every chain.",
    start_url: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#16a34a",
    orientation: "portrait",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      { src: "/icon", sizes: "32x32", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
