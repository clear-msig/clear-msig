import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Agents · Clear",
  description:
    "Agent trading where traders submit decisions and ClearSig enforces user rules.",
};

export default function AgentPage() {
  return <ProductSurfaceLanding id="agent" />;
}
