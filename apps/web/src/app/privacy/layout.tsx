import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Privacy",
  description: "How ClearSig protects policy information and keeps sensitive treasury rules private.",
  path: "/privacy",
});

export default function PrivacyLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
