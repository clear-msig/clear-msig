import type { Metadata } from "next";
import { ProductChooser } from "@/components/product/ProductChooser";

export const metadata: Metadata = {
  title: "Choose a ClearSig product",
  description: "Choose the ClearSig wallet built for what you need to do.",
};

export default function ChoosePage() {
  return <ProductChooser />;
}
