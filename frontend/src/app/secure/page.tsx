import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Secure · Clear",
  description:
    "Personal key recovery with passkey thresholds and recoverable custody.",
};

export default function SecureProductPage() {
  return <ProductSurfaceLanding id="secure" />;
}
