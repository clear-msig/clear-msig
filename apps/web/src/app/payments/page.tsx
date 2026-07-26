import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Payments",
  description: "Readable payment approvals and payout review across ClearSig Personal, Pro, and Agent workflows.",
  path: "/payments",
});

export default function PaymentsPage() {
  return <ProductSurfaceLanding id="payments" />;
}
