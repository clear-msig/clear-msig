import type { Metadata, MetadataRoute } from "next";

export const SITE_NAME = "ClearSig";
export const SITE_ORIGIN = "https://clearsig.xyz";
export const SITE_TITLE = "ClearSig — Sign intents. Not hex.";
export const SITE_DESCRIPTION =
  "Policy-driven shared wallets for teams, businesses, DAOs, and AI agents. Approve readable actions instead of blind-signing transaction hashes.";
export const SITE_SOCIAL_IMAGE_PATH = "/social/clearsig-og.png";
export const SITE_SOCIAL_IMAGE_ALT =
  "ClearSig — Sign intents. Not hex. One treasury. Multiple chains. Zero blind-signing.";

export const PUBLIC_SITE_ROUTES = [
  "/",
  "/choose",
  "/personal",
  "/pro",
  "/secure",
  "/agent",
  "/agents",
  "/payments",
  "/p2pdefi",
  "/security",
  "/privacy",
] as const;

const SOCIAL_IMAGE = {
  url: SITE_SOCIAL_IMAGE_PATH,
  width: 1200,
  height: 630,
  alt: SITE_SOCIAL_IMAGE_ALT,
  type: "image/png",
} as const;

export const siteMetadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: {
    default: SITE_TITLE,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_ORIGIN }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: "finance",
  keywords: [
    "policy-driven wallet",
    "shared treasury",
    "multichain treasury",
    "clear signing",
    "transaction intents",
    "DAO treasury",
    "AI agent wallet",
    "multisig wallet",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "/",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    siteName: SITE_NAME,
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  formatDetection: {
    telephone: false,
    address: false,
    email: false,
  },
  icons: {
    icon: [{ url: "/clearmark-light.svg", type: "image/svg+xml" }],
    apple: [{ url: "/clearmark-light.svg", type: "image/svg+xml" }],
  },
};

interface PageMetadataInput {
  title: string;
  description: string;
  path: `/${string}`;
  type?: "website" | "profile";
  index?: boolean;
}

export function createPageMetadata({
  title,
  description,
  path,
  type = "website",
  index = true,
}: PageMetadataInput): Metadata {
  const socialTitle = title.includes(SITE_NAME) ? title : `${title} | ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type,
      locale: "en_US",
      url: path,
      title: socialTitle,
      description,
      siteName: SITE_NAME,
      images: [SOCIAL_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: socialTitle,
      description,
      images: [SOCIAL_IMAGE],
    },
    robots: index ? undefined : { index: false, follow: false },
  };
}

export function createPrivateMetadata(title = "Workspace"): Metadata {
  return createPageMetadata({
    title,
    description: SITE_DESCRIPTION,
    path: "/app",
    index: false,
  });
}

export function createSiteManifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: "/",
    display: "standalone",
    background_color: "#070807",
    theme_color: "#ccff00",
    orientation: "portrait",
    categories: ["finance", "productivity", "utilities"],
    icons: [
      {
        src: "/appLogoPWA/pwaLogo.svg",
        sizes: "512x512",
        type: "image/svg+xml",
      },
    ],
  };
}
