import { ProductChooser } from "@/components/product/ProductChooser";
import { createPageMetadata } from "@/lib/metadata/site";

export const metadata = createPageMetadata({
  title: "Choose a product",
  description: "Choose the ClearSig product built for your treasury, personal security, payments, or agent workflows.",
  path: "/choose",
});

export default function ChoosePage() {
  return <ProductChooser />;
}
