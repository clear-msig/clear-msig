import type { Metadata } from "next";
import { ProductChooserPage } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "Choose ClearSig Product · Clear",
  description:
    "Choose ClearSig Personal, ClearSig Pro, or ClearSig Agents before onboarding.",
};

export default function ChoosePage() {
  return <ProductChooserPage />;
}
