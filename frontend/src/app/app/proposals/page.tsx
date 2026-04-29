"use client";

// Legacy redirect — /app/proposals lives inside /app/wallet/[name] now
// as a tab. Visiting this route bounces users to /app/wallet so they
// can pick which wallet they want to view proposals for.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProposalsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/wallet");
  }, [router]);
  return null;
}
