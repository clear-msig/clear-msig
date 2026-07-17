"use client";

// Legacy redirect - the canonical send URL is now
// /app/wallet/[name]/send. Kept around so old links, bookmarks, and
// any in-flight email/Slack notifications still land somewhere
// useful. Pulls the wallet name out of `?wallet=...` and forwards
// every other query param (recipient, amount, note) along.

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LegacySendPage() {
  return (
    <Suspense fallback={null}>
      <LegacySendRedirect />
    </Suspense>
  );
}

function LegacySendRedirect() {
  const router = useRouter();
  const search = useSearchParams();
  useEffect(() => {
    const wallet = search?.get("wallet")?.trim();
    if (!wallet) {
      router.replace("/app");
      return;
    }
    const params = new URLSearchParams(search?.toString() ?? "");
    params.delete("wallet");
    const qs = params.toString();
    router.replace(
      `/app/wallet/${encodeURIComponent(wallet)}/send${qs ? `?${qs}` : ""}`,
    );
  }, [router, search]);
  return null;
}
