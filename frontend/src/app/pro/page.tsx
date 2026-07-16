import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Pro",
  description: "Policy-driven treasury controls for teams, businesses, and DAOs, with readable approvals across chains.",
  path: "/pro",
});

export default function ProPage() {
  return <ProductSurfaceLanding id="pro" />;
}
