import type { Metadata } from "next";
import { ProductChooserPage } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "Choose ClearSig Product · Clear",
  description:
    "Choose ClearSig Personal, Pro, Agents, Secure, or P2P DeFi before onboarding.",
};

export default function ChoosePage() {
  return <ProductChooserPage />;
}
