"use client";

import { useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function snapshot() {
  return typeof window === "undefined" || !window.matchMedia
    ? true
    : window.matchMedia(query).matches;
}

// Render visible, still content on the server and during hydration. Reading the
// browser preference before hydration can remove animated DOM nodes or leave
// server-rendered opacity:0 behind when a component drops its motion props.
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, () => true);
}
