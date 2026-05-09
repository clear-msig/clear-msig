"use client";

// Legacy redirect - canonical Ethereum send is now
// /app/wallet/[name]/send/eth.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LegacySendEthPage() {
  return (
    <Suspense fallback={null}>
      <LegacySendEthRedirect />
    </Suspense>
  );
}

function LegacySendEthRedirect() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const wallet = search?.get("wallet")?.trim();
    if (!wallet) {
      router.replace("/app/wallet");
      return;
    }
    const params = new URLSearchParams(search?.toString() ?? "");
    params.delete("wallet");
    const qs = params.toString();
    router.replace(
      `/app/wallet/${encodeURIComponent(wallet)}/send/eth${qs ? `?${qs}` : ""}`,
    );
  }, [router, search]);
  return null;
}
