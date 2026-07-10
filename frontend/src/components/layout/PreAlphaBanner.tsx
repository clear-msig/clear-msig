"use client";

// Pre-alpha truth signal - formerly a persistent banner, now a
// one-time toast.
//
// The old PreAlphaBanner sat under the header on every /app/* route,
// dismissable per session. Users navigating between wallets, send,
// settings, members would re-see the warning every page; the banner
// undermined the trust signal the rest of the UI was building. Now
// the message fires as a single toast on the user's first visit
// (localStorage-keyed so it survives across tabs and sessions). The
// truth signal still ships; the visual chrome is gone.

import { useEffect } from "react";
import { useToast } from "@/components/ui/Toast";

const STORAGE_KEY = "clear-msig.preAlphaBanner.acknowledged.v1";

export function PreAlphaBanner() {
  const toast = useToast();

  useEffect(() => {
    let acknowledged = false;
    try {
      acknowledged = localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
      // Private mode / sandboxed iframe. Show the toast - better to
      // tell the user once on every fresh tab than to skip the truth
      // signal entirely.
    }
    if (acknowledged) return;

    // Keep the first viewport usable. This is a status disclosure,
    // not a blocking onboarding step.
    toast.info(
      "Preview mode. Testnet only, so keep amounts small.",
      { durationMs: 6000 },
    );

    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* noop */
    }
    // Run once per mount; toast dependency is stable from the
    // provider, so the effect won't re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return null;
}
