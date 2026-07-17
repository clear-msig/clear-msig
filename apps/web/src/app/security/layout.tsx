import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Security",
  description: "ClearSig's security architecture, trust boundaries, protections, and current limitations.",
  path: "/security",
});

export default function SecurityLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
