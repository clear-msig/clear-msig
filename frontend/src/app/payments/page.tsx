import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Payments · Clear",
  description:
    "Payment approvals and payout review are being folded into ClearSig Personal, Pro, and Agents workflows.",
};

export default function PaymentsPage() {
  return <ProductSurfaceLanding id="payments" />;
}
