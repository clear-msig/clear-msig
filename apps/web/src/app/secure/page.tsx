import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Secure",
  description: "Personal key recovery with passkey thresholds and recoverable custody.",
  path: "/secure",
});

export default function SecureProductPage() {
  return <ProductSurfaceLanding id="secure" />;
}
