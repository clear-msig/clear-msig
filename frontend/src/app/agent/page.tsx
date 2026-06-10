import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Agents · Clear",
  description:
    "Policy-bound agent trading where agents submit decisions and ClearSig enforces user rules.",
};

export default function AgentPage() {
  return <ProductSurfaceLanding id="agent" />;
}
