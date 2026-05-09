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

    // 14s gives a comfortable read for the line; not so long that it
    // hangs around if the user is mid-interaction. Toast system
    // dismisses on click and on auto-timeout either way.
    toast.info(
      "This is a preview. Everything works, but it's running on a test network. Keep amounts small while we're still in early days.",
      { durationMs: 14000 },
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
