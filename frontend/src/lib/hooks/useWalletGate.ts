"use client";

// Wallet gate centralizes navigation behavior tied to connection state.
import { useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { usePathname, useRouter } from "next/navigation";

const APP_PREFIX = "/app";

export function useWalletGate() {
  const wallet = useWallet();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (wallet.connected && pathname === "/") {
      router.replace("/app/wallet");
      return;
    }
    if (!wallet.connected && pathname.startsWith(APP_PREFIX)) {
      router.replace("/");
    }
  }, [wallet.connected, pathname, router]);

  return {
    connected: wallet.connected,
    publicKey: wallet.publicKey?.toBase58() ?? null
  };
}
