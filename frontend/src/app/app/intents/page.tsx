"use client";

// Legacy redirect - /app/intents lives inside /app/wallet/[name] now as
// a tab. Visiting this route bounces users to /app/wallet so they can
// pick which wallet they want to manage intents for.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function IntentsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/app/wallet");
  }, [router]);
  return null;
}
