"use client";

// Theme initialiser — runs on EVERY app load and writes the right
// data-theme attribute on <html> before any visible content
// renders. Reading localStorage at component-mount time would flash
// light first, then flip to dark. The Script tag in /app/layout.tsx
// (or here, an inline-as-soon-as-possible effect) does the work
// before paint.
//
// We use an inline script via dangerouslySetInnerHTML in the head
// of the Next.js root layout (app/layout.tsx). This component is
// the per-page hydration guard that re-applies if the user changes
// the preference at runtime.

import { useEffect } from "react";
import { applyTheme, getStoredTheme } from "@/lib/security/theme";

export function ThemeBootstrap() {
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);
  return null;
}
