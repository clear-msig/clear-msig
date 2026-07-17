"use client";

// PWA install glue. Browsers don't expose a permission API for "is
// this site installable?" - instead they fire a `beforeinstallprompt`
// event when the heuristics say yes (manifest valid, https, prior
// engagement). We capture the event, expose a `prompt()` that fires
// the saved Event.prompt(), and watch `appinstalled` to flip state.
//
// iOS Safari doesn't fire beforeinstallprompt at all - install on
// iOS is via the Share sheet → "Add to Home Screen". Detect iOS
// Safari so the UI can render those instructions instead.
//
// Already-installed detection: `(display-mode: standalone)` matches
// when the app is launched from the home-screen icon. Suppress the
// install affordance in that case.

import { useCallback, useEffect, useState } from "react";

/// Minimal shape of the BeforeInstallPromptEvent. Typed locally to
/// avoid lib-dom changes (the event is non-standard but stable on
/// Chromium-based browsers + Samsung Internet).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallStatus =
  /// Already installed - don't show the affordance.
  | "installed"
  /// Browser fired beforeinstallprompt - `prompt()` is callable.
  | "available"
  /// iOS Safari (or another non-Chromium browser that supports
  /// home-screen install but doesn't expose the API). Show manual
  /// instructions instead of a button.
  | "manual"
  /// Unsupported / no install path. Hide the row.
  | "unsupported";

export interface UseInstallPromptResult {
  status: InstallStatus;
  /// Fire the saved beforeinstallprompt. No-op when status !==
  /// "available". Resolves to the user's choice.
  prompt: () => Promise<"accepted" | "dismissed" | "noop">;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // matchMedia covers Chrome / Edge / Firefox / Samsung Internet.
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari uses navigator.standalone (non-standard).
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  // Roughly: iOS user-agent string includes iPhone/iPad/iPod, AND we
  // need to distinguish Safari from in-app webviews / Chrome on iOS.
  // Chrome on iOS uses Safari's WebKit but UA includes "CriOS";
  // Firefox iOS includes "FxiOS"; in-app webviews vary.
  const iOS = /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
  if (!iOS) return false;
  const isCriOS = /CriOS|FxiOS|EdgiOS/.test(ua);
  return !isCriOS;
}

export function useInstallPrompt(): UseInstallPromptResult {
  const [savedEvent, setSavedEvent] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [installed, setInstalled] = useState(false);
  const [iosSafari, setIosSafari] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIosSafari(isIosSafari());

    const onBefore = (e: Event) => {
      // Stash the event so we can fire it later from a user gesture.
      // Calling preventDefault keeps the browser's own infobar away,
      // which is the documented contract for custom-UI installs.
      e.preventDefault();
      setSavedEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setSavedEvent(null);
    };
    window.addEventListener("beforeinstallprompt", onBefore);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBefore);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const prompt = useCallback(async (): Promise<
    "accepted" | "dismissed" | "noop"
  > => {
    if (!savedEvent) return "noop";
    try {
      await savedEvent.prompt();
      const choice = await savedEvent.userChoice;
      // The event is one-shot - Chrome won't re-fire prompt() on
      // the same instance. Drop our reference so the row hides
      // until the browser fires beforeinstallprompt again (it does
      // when the user dismisses + revisits later).
      setSavedEvent(null);
      return choice.outcome;
    } catch {
      setSavedEvent(null);
      return "noop";
    }
  }, [savedEvent]);

  let status: InstallStatus;
  if (installed) status = "installed";
  else if (savedEvent) status = "available";
  else if (iosSafari) status = "manual";
  else status = "unsupported";

  return { status, prompt };
}
