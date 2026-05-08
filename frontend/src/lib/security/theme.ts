"use client";

// Light / dark / system theme switch. Persists the user's choice in
// localStorage and writes a `data-theme` attribute on <html> that
// globals.css uses to swap the 5 semantic CSS vars (canvas /
// surface-raised / text-strong / text-soft / border-soft).
//
// Why 3 modes:
//   - "light"  — always light, regardless of OS preference.
//   - "dark"   — always dark.
//   - "system" — follow `prefers-color-scheme`; flips with OS.
//
// Default on first load is "system" so users who already run their
// OS dark inherit it without configuration. The choice gets
// persisted in localStorage and applied early in
// `theme-init-script.ts` to avoid the dreaded light-mode flash on
// reload.

const STORAGE_KEY = "clear.theme.v1";

export type ThemeMode = "light" | "dark" | "system";

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

/// Imperatively flip the data-theme attribute on <html>. Safe to
/// call from anywhere; idempotent.
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", mode);
}
