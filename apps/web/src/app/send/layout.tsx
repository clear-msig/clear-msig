import { createPrivateMetadata } from "@/lib/metadata/site";

export const metadata = createPrivateMetadata("Send");

export default function LegacySendLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
