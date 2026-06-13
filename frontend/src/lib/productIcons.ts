import {
  Bot,
  Building2,
  CreditCard,
  Handshake,
  KeyRound,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ProductSurfaceId } from "@/lib/productSurfaces";

export const PRODUCT_SURFACE_ICON: Record<ProductSurfaceId, LucideIcon> = {
  personal: Users,
  pro: Building2,
  agent: Bot,
  secure: KeyRound,
  p2pdefi: Handshake,
  payments: CreditCard,
};

export function productSurfaceIcon(
  surface: ProductSurfaceId | null | undefined,
): LucideIcon {
  return surface ? PRODUCT_SURFACE_ICON[surface] : Wallet;
}
