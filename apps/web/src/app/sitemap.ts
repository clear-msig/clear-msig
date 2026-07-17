import type { MetadataRoute } from "next";
import { PUBLIC_SITE_ROUTES, SITE_ORIGIN } from "@/lib/metadata/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_SITE_ROUTES.map((path) => ({
    url: new URL(path, SITE_ORIGIN).toString(),
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.7,
  }));
}
