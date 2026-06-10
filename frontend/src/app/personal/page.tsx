import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Personal · Clear",
  description:
    "Personal shared wallet protection with multiple devices or wallets and no policy setup required.",
};

export default function PersonalPage() {
  return <ProductSurfaceLanding id="personal" />;
}
