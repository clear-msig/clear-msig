import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Personal",
  description: "Readable shared-wallet protection for individuals and families across multiple devices and wallets.",
  path: "/personal",
});

export default function PersonalPage() {
  return <ProductSurfaceLanding id="personal" />;
}
