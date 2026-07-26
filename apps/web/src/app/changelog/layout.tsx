import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Changelog",
  description: "ClearSig product, security, architecture, and onchain implementation updates.",
  path: "/changelog",
  index: false,
});

export default function ChangelogLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
