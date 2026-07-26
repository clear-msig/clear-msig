import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "P2P DeFi",
  description: "Peer-to-peer DeFi coordination with signed intents and policy-checked settlement is coming soon.",
  path: "/p2pdefi",
});

export default function P2PDeFiPage() {
  return <ProductSurfaceLanding id="p2pdefi" />;
}
