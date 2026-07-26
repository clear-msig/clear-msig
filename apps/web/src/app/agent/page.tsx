import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Agent Vault",
  description: "Agent vaults governed by readable user policies, explicit approvals, and verifiable execution evidence.",
  path: "/agent",
});

export default function AgentPage() {
  return <ProductSurfaceLanding id="agent" />;
}
