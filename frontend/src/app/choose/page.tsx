import type { Metadata } from "next";
import { ProductChooserPage } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "Choose ClearSig Product · Clear",
  description:
    "Choose ClearSig Personal, Pro, Agents, Secure, P2P DeFi, or Payments before onboarding.",
};

export default function ChoosePage() {
  return <ProductChooserPage />;
}
