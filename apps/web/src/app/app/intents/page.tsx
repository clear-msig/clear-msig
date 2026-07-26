"use client";

// Legacy redirect - /app/intents lives inside /app/wallet/[name] now as
// a tab. Visiting this route bounces users to the app resolver.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function IntentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app");
  }, [router]);
  return null;
}
