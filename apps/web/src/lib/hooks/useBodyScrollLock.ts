"use client";

// Body scroll lock for modal overlays.
//
// On iOS Safari, a fixed/absolute modal does not stop the body
// underneath from scrolling - momentum scroll on the modal can
// bleed through, and a touch-drag on the page outside the modal
// scrolls the page even while the modal is "blocking" interaction.
//
// The fix: while a modal is open, set `overflow: hidden` on
// `<html>` (not `<body>` - `<body>` is unreliable on iOS). This
// freezes the page underneath. We also stash the previous value
// so concurrent locks compose correctly: if two modals open, only
// the second's unlock restores the original overflow.
//
// Use:
//   useBodyScrollLock(open);  // toggles based on the boolean
//
// The hook is a no-op on SSR.

import { useEffect } from "react";

/// Tracks how many active locks exist so concurrent modals don't
/// step on each other. The first lock captures the original
/// overflow; the last unlock restores it. Locks in between are
/// just refcount bumps.
let lockCount = 0;
let originalOverflow: string | null = null;

export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (lockCount === 0) {
      originalOverflow = root.style.overflow;
      root.style.overflow = "hidden";
    }
    lockCount += 1;
    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        // Restore the original - null means no inline style was
        // set, so we clear the property to fall back to whatever
        // CSS was applying.
        if (originalOverflow === null || originalOverflow === "") {
          root.style.removeProperty("overflow");
        } else {
          root.style.overflow = originalOverflow;
        }
        originalOverflow = null;
      }
    };
  }, [active]);
}
