"use client";

// Onboarding completion state, backed by localStorage.
//
// Tracks whether the user has finished (or skipped) the first-visit
// walkthrough. The HeaderBar uses this to decide whether to reveal the
// Connect Wallet button; OnboardingWalkthrough uses it to decide whether
// to render at all.

import { useCallback, useEffect, useState } from "react";

// v2 — bumped because the v1 flag was set on every developer/tester
// browser before the walkthrough had its current form. Bumping the key
// forces a fresh first-visit experience for everyone.
const STORAGE_KEY = "clear-msig.onboarding.completed.v2";

export function useOnboarding() {
  // Default to completed=true so SSR renders the post-onboarding UI; the
  // real value loads after mount and re-renders if needed. This avoids a
  // flash of the modal during hydration.
  const [completed, setCompleted] = useState<boolean>(true);
  const [hydrated, setHydrated] = useState<boolean>(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      setCompleted(v === "1");
    } catch {
      // localStorage blocked (private browsing, sandboxed iframes). Fail
      // open so the user is never stuck behind a modal that can't persist.
      setCompleted(true);
    }
    setHydrated(true);
  }, []);

  const complete = useCallback(() => {
    setCompleted(true);
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* noop */
    }
  }, []);

  const reset = useCallback(() => {
    setCompleted(false);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* noop */
    }
  }, []);

  return { completed, hydrated, complete, reset };
}
