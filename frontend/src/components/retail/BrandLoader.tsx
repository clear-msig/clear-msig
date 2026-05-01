"use client";

// BrandLoader — the single waiting indicator the app uses.
//
// Two variants:
//   - "ring"  (default): a thin accent ring rotating around an
//     accent-tinted ghost, evoking a wallet badge cycling. Used at
//     full-screen / page-level wait states.
//   - "dot"  : three accent dots breathing in sequence. Inline
//     replacement for spinner icons in row contexts.
//
// Why a custom one when Loader2 ships free with lucide: a single
// branded animation that recurs across every wait state is what
// makes the product feel made instead of assembled (Squads pulls the
// same trick with their rotating-pixel loader). Compositor-only so
// it stays inside the 70fps budget even on a busy page.

import { useReducedMotion } from "framer-motion";

interface BrandLoaderProps {
  variant?: "ring" | "dot";
  /// Pixel size of the long edge. Defaults to 32 for ring, 8 for dot.
  size?: number;
  /// Optional extra classes for layout (mt-, etc.).
  className?: string;
  /// Accessible label. Defaults to "Loading".
  label?: string;
}

export function BrandLoader({
  variant = "ring",
  size,
  className,
  label = "Loading",
}: BrandLoaderProps) {
  const reduce = useReducedMotion();
  if (variant === "dot") {
    const px = size ?? 8;
    return (
      <span
        role="status"
        aria-label={label}
        className={"inline-flex items-center gap-1.5 " + (className ?? "")}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            style={{
              width: px,
              height: px,
              animationDelay: reduce ? undefined : `${i * 160}ms`,
            }}
            className={
              "block rounded-full bg-accent " +
              (reduce ? "opacity-70" : "animate-bounce")
            }
          />
        ))}
        <span className="sr-only">{label}</span>
      </span>
    );
  }
  const px = size ?? 32;
  return (
    <span
      role="status"
      aria-label={label}
      className={"relative inline-flex shrink-0 " + (className ?? "")}
      style={{ width: px, height: px }}
    >
      {/* Ghost — accent-tinted disc behind the ring. Gives the loader
          a "filled" identity even at small sizes where a pure ring
          reads as a generic icon. */}
      <span
        aria-hidden="true"
        className="absolute inset-0 rounded-full bg-accent/15"
      />
      {/* Rotating ring — three-quarter arc so the rotation is
          legible. transform-only animation, no layout. */}
      <span
        aria-hidden="true"
        style={{ borderWidth: Math.max(2, Math.round(px / 16)) }}
        className={
          "absolute inset-0 rounded-full border-accent border-t-transparent " +
          (reduce ? "" : "animate-spin")
        }
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
