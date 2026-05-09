"use client";

// Light / dark / system theme switch. Persists the user's choice in
// localStorage and writes a `data-theme` attribute on <html> that
// globals.css uses to swap the full palette of CSS vars.
//
// Why 3 modes:
//   - "light"  - always light, regardless of OS preference.
//   - "dark"   - always dark.
//   - "system" - follow `prefers-color-scheme`; flips with OS.
//
// Default on first load is "system" so users who already run their
// OS dark inherit it without configuration. The choice gets
// persisted in localStorage and applied early in
// `theme-init-script.ts` to avoid the dreaded light-mode flash on
// reload + the React 19 hydration mismatch the previous attempt hit.
//
// Force-dark routes (landing, welcome): the data-theme on <html> is
// always "dark" regardless of stored preference. setStoredTheme
// still writes the localStorage value (so when the user navigates
// back into /app/* their preference is preserved), but the rendered
// theme on those routes stays dark.

import { FORCE_DARK_PATHS, STORAGE_KEY } from "./theme-init-script";

export type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

const TRANSITION_CLASS = "theme-transitioning";
const TRANSITION_MS = 250;

export function isThemeMode(x: unknown): x is ThemeMode {
  return x === "light" || x === "dark" || x === "system";
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isThemeMode(v) ? v : "system";
  } catch {
    return "system";
  }
}

export function setStoredTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  applyTheme(mode);
}

/// Resolve the abstract preference (`"system"` follows OS) into a
/// concrete theme name and apply it to `<html data-theme>`. Adds a
/// short-lived `theme-transitioning` class so the swap fades through
/// global transitions instead of snapping per-element.
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  // Force-dark paths override every preference. Landing + welcome
  // are marketing-dark by design.
  const path = window.location.pathname;
  const isForcedDark =
    FORCE_DARK_PATHS.includes(path) || path.startsWith("/welcome/");

  const resolved: ResolvedTheme = isForcedDark ? "dark" : resolveTheme(mode);

  const html = document.documentElement;
  const current = html.getAttribute("data-theme");

  // Already in the right theme - no transition needed.
  if (current === resolved) return;

  html.classList.add(TRANSITION_CLASS);
  html.setAttribute("data-theme", resolved);

  // Strip the transition class after the visual swap completes so
  // hover/focus animations get their natural per-element timing
  // back. setTimeout (not RAF chain) so we can cancel/restart cleanly
  // if the user toggles again mid-swap.
  const w = window as unknown as { __themeTransitionTimeout?: number };
  if (typeof w.__themeTransitionTimeout === "number") {
    window.clearTimeout(w.__themeTransitionTimeout);
  }
  w.__themeTransitionTimeout = window.setTimeout(() => {
    html.classList.remove(TRANSITION_CLASS);
  }, TRANSITION_MS);
}

/// Resolve "system" → matchMedia result; "light"/"dark" pass through.
function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window === "undefined") return "dark";
  try {
    return window.matchMedia("(prefers-color-scheme: light)").matches
      ? "light"
      : "dark";
  } catch {
    return "dark";
  }
}

/// Listen for OS theme flips when the user has chosen "system". Re-
/// applies the theme so the page repaints without a reload. Returns a
/// dispose function. Call from a top-level provider (e.g. layout) so
/// the listener lives for the whole session.
export function watchSystemTheme(): () => void {
  if (typeof window === "undefined") return () => {};

  let mq: MediaQueryList;
  try {
    mq = window.matchMedia("(prefers-color-scheme: light)");
  } catch {
    return () => {};
  }

  const handler = () => {
    if (getStoredTheme() === "system") {
      applyTheme("system");
    }
  };

  // Older Safari uses addListener / removeListener.
  if (typeof mq.addEventListener === "function") {
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (mq as unknown as any).addListener(handler);
  return () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mq as unknown as any).removeListener(handler);
  };
}
