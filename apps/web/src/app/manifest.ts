// PWA manifest for "add to home screen" support on mobile.
//
// Standalone display mode means iOS/Android home-screen launches open
// the site without browser chrome. Combined with the apple-icon and
// icon files in this directory it behaves like a native shell.

import type { MetadataRoute } from "next";
import { createSiteManifest } from "@/lib/metadata/site";

export default function manifest(): MetadataRoute.Manifest {
  return createSiteManifest();
}
