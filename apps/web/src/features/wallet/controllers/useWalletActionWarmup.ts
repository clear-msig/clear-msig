"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Warms the two primary wallet actions after the detail screen is stable. */
export function useWalletActionWarmup(walletName: string): void {
  const router = useRouter();

  useEffect(() => {
    if (!walletName) return;
    const encoded = encodeURIComponent(walletName);
    const routes = [
      `/app/wallet/${encoded}/send`,
      `/app/wallet/${encoded}/receive`,
    ];
    const warm = () => {
      for (const route of routes) router.prefetch(route);
    };

    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 1_000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(warm, 250);
    return () => window.clearTimeout(id);
  }, [router, walletName]);
}
