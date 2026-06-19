import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Pro · Clear",
  description:
    "Company multisig treasury controls with readable protection choices.",
};

export default function ProPage() {
  return <ProductSurfaceLanding id="pro" />;
}
