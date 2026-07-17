import ConnectClient from "./ConnectClient";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Connect",
  description: "Connect a wallet or sign in to access ClearSig's policy-driven treasury products.",
  path: "/connect",
  index: false,
});

export default function ConnectPage() {
  return <ConnectClient />;
}
