import type { Metadata } from "next";
import { ProductSurfaceLanding } from "@/components/product/ProductSurfaceLanding";

export const metadata: Metadata = {
  title: "ClearSig Payments · Clear",
  description:
    "Payment approvals, invoices, recurring payment controls, and payout review.",
};

export default function PaymentsPage() {
  return <ProductSurfaceLanding id="payments" />;
}
