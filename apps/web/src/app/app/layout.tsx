import { createPrivateMetadata } from "@/lib/metadata/site";
import WorkspaceLayoutClient from "./WorkspaceLayoutClient";

export const metadata = createPrivateMetadata();

export default function WorkspaceLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <WorkspaceLayoutClient>{children}</WorkspaceLayoutClient>;
}
