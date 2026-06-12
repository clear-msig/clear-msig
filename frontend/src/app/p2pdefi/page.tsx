import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig P2P DeFi Coming Soon · Clear",
  description:
    "Peer-to-peer DeFi coordination with signed intents and policy-checked settlement is coming soon.",
};

export default function P2PDeFiPage() {
  return <ProductSurfaceLanding id="p2pdefi" />;
}
