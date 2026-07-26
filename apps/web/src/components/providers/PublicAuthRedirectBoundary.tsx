"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { useWallet } from "@/lib/wallet";

export default function PublicAuthRedirectBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  useWalletGate();
  const wallet = useWallet();
  const router = useRouter();

  useEffect(() => {
    if (wallet.connecting || !wallet.loggedInWithoutSolana) return;
    router.replace("/connect");
  }, [router, wallet.connecting, wallet.loggedInWithoutSolana]);

  if (wallet.connecting || wallet.connected || wallet.loggedInWithoutSolana) {
    return <PublicAuthChecking />;
  }

  return children;
}

function PublicAuthChecking() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="h-10 w-10 animate-pulse rounded-full bg-accent shadow-accent-rest" />
    </main>
  );
}
