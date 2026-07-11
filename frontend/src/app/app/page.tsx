"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet";
import {
  fetchOnchainMemberships,
  type OnchainMembership,
} from "@/lib/memberships/client";
import {
  productWorkspaceHomeHref,
  resolveWalletProductSurface,
} from "@/lib/productWorkspace";
import { productSetupHref } from "@/lib/productSurfaces";
import {
  readPendingProductSurface,
  readSelectedProductSurface,
} from "@/lib/productSession";
import AppLoading from "./loading";

export default function AppEntryPage() {
  const wallet = useWallet();
  const router = useRouter();
  const address = wallet.publicKey?.toBase58() ?? "";

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0 && wallet.connected,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });

  useEffect(() => {
    if (!wallet.connected || memberships.isLoading || memberships.isFetching) {
      return;
    }

    const firstWallet = firstWorkspaceHref(memberships.data ?? []);
    if (firstWallet) {
      router.replace(firstWallet);
      return;
    }

    const preferredSurface =
      readPendingProductSurface() ?? readSelectedProductSurface(address);
    router.replace(
      preferredSurface ? productSetupHref(preferredSurface) : "/app/wallet/new",
    );
  }, [
    address,
    memberships.data,
    memberships.isFetching,
    memberships.isLoading,
    router,
    wallet.connected,
  ]);

  return <AppLoading />;
}

function firstWorkspaceHref(wallets: OnchainMembership[]): string | null {
  for (const membership of wallets) {
    const walletName = membership.wallet_name?.trim();
    if (!walletName) continue;
    return productWorkspaceHomeHref(
      walletName,
      resolveWalletProductSurface(walletName),
    );
  }
  return null;
}
