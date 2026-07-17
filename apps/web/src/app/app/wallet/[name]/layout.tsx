"use client";

import { useEffect } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import { getWalletAppearance } from "@/lib/retail/walletAppearance";
import {
  productWorkspaceRedirectHref,
  walletProductSurface,
} from "@/lib/productWorkspace";

export default function WalletProductLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const params = useParams<{ name: string }>();
  const pathname = usePathname() ?? "";
  const router = useRouter();

  useEffect(() => {
    const raw = params?.name ?? "";
    const walletName = decodeRouteParam(raw);
    if (!walletName) return;
    const surface = walletProductSurface(getWalletAppearance(walletName)?.surface);
    const redirect = productWorkspaceRedirectHref({
      walletName,
      surface,
      pathname,
    });
    if (redirect && redirect !== pathname) {
      router.replace(redirect);
    }
  }, [params?.name, pathname, router]);

  return children;
}

function decodeRouteParam(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
