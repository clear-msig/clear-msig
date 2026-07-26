"use client";

// Brand mark — the product "C" logo. Renders a SINGLE <img> tag
// whose variant tracks the active theme:
//   • light theme → dark-arc variant (clearmark-light.svg)
//   • dark theme  → white-arc variant (clearmark-dark.svg)
//
// Theme source of truth: the `data-theme` attribute on <html>, set
// before paint by `theme-init-script.ts` and re-applied at runtime
// by `applyTheme()` in `lib/security/theme.ts`. We subscribe to
// attribute changes via MutationObserver so toggling theme at
// runtime flips the mark without a remount.
//
// useSyncExternalStore makes the read SSR-safe: we always render
// the "dark" variant on the server, then swap to the right one on
// hydrate. Single network fetch — the off-variant SVG is never
// downloaded.
//
// Usage:
//   <BrandMark size={16} />        // sidebar / drawer / badge
//   <BrandMark size={20} />        // header
//   <BrandMark size={32} />        // landing-nav / marketing

import { useSyncExternalStore } from "react";
import { ClearCMark } from "@/components/landing/ClearCMark";

interface BrandMarkProps {
  size?: number;
  className?: string;
}

function subscribe(callback: () => void): () => void {
  if (typeof document === "undefined") return () => {};
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => observer.disconnect();
}

function getSnapshot(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.getAttribute("data-theme") === "light"
    ? "light"
    : "dark";
}

function getServerSnapshot(): "light" | "dark" {
  return "dark";
}

export function BrandMark({ size = 20, className }: BrandMarkProps) {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const variant = theme === "light" ? "on-light" : "on-dark";
  return <ClearCMark size={size} variant={variant} className={className} />;
}
