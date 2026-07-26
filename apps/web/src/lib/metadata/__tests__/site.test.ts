import { describe, expect, it } from "vitest";
import {
  createPageMetadata,
  createPrivateMetadata,
  createSiteManifest,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_SOCIAL_IMAGE_PATH,
  SITE_TITLE,
  siteMetadata,
} from "@/lib/metadata/site";

describe("site metadata", () => {
  it("keeps the production brand and social card in one root contract", () => {
    expect(SITE_TITLE).toBe("ClearSig — Sign intents. Not hex.");
    expect(SITE_TITLE.length).toBeLessThanOrEqual(60);
    expect(SITE_DESCRIPTION).toContain("Approve readable actions");
    expect(siteMetadata.metadataBase?.toString()).toBe(`${SITE_ORIGIN}/`);
    expect(siteMetadata.applicationName).toBe(SITE_NAME);
    expect(siteMetadata.alternates?.canonical).toBe("/");
    expect(siteMetadata.openGraph).toMatchObject({
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      siteName: SITE_NAME,
      images: [expect.objectContaining({ url: SITE_SOCIAL_IMAGE_PATH, width: 1200, height: 630 })],
    });
    expect(siteMetadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: SITE_TITLE,
      images: [expect.objectContaining({ url: SITE_SOCIAL_IMAGE_PATH, width: 1200, height: 630 })],
    });
  });

  it("builds complete route metadata without losing inherited social fields", () => {
    const metadata = createPageMetadata({
      title: "Pro",
      description: "Readable treasury controls.",
      path: "/pro",
    });
    expect(metadata.title).toBe("Pro");
    expect(metadata.alternates?.canonical).toBe("/pro");
    expect(metadata.openGraph).toMatchObject({
      url: "/pro",
      title: "Pro | ClearSig",
      siteName: SITE_NAME,
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      title: "Pro | ClearSig",
    });
  });

  it("prevents authenticated routes from being indexed", () => {
    const metadata = createPrivateMetadata("Workspace");
    expect(metadata.alternates?.canonical).toBe("/app");
    expect(metadata.robots).toMatchObject({ index: false, follow: false });
  });

  it("uses the same identity in the installable app manifest", () => {
    expect(createSiteManifest()).toMatchObject({
      name: SITE_NAME,
      short_name: SITE_NAME,
      description: SITE_DESCRIPTION,
      background_color: "#070807",
      theme_color: "#ccff00",
    });
  });
});
