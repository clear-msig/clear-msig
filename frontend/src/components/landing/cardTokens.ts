// Shared card design tokens for the whole landing page.
//
// Every card across every section imports from this file so sizes,
// radii, gaps, and type scale stay perfectly consistent from mobile
// up to wide desktop. The values are expressed as `clamp()` inside
// Tailwind arbitrary-value classes, so they flow smoothly with
// viewport width, never jumping at breakpoints.
//
// Reading a clamp: `clamp(min, fluid, max)` picks `fluid` while it
// sits between `min` and `max`. Bumping one token here changes every
// card in lock step.
//
// Tailwind's JIT scans this file (it lives under `src/**/*.{ts,tsx}`)
// so the utility classes below are generated automatically. No manual
// safelisting needed.

export const CARD = {
  // ── Geometry ────────────────────────────────────────────────────

  /// Outer rounded corner. 14 → 24px.
  radius: "rounded-[clamp(0.875rem,1.4vw,1.5rem)]",
  /// Inner padding. 14 → 20px.
  padding: "p-[clamp(0.875rem,1.1vw,1.25rem)]",
  /// Gap between children inside a card. 6 → 12px.
  gapInner: "gap-[clamp(0.4rem,0.9vw,0.75rem)]",

  // ── Typography ──────────────────────────────────────────────────

  /// Card title. 15 → 19px.
  title: "text-[clamp(0.95rem,1.25vw,1.2rem)]",
  /// Card body. 11.5 → 14px.
  body: "text-[clamp(0.78rem,1vw,0.9rem)] leading-snug",
  /// Section or card eyebrow chip. 9.3 → 11.2px.
  eyebrow: "text-[clamp(0.58rem,0.75vw,0.7rem)]",
  /// Small mono labels inside cards. 8.8 → 10.4px.
  mono: "text-[clamp(0.55rem,0.7vw,0.65rem)]",

  // ── Icon chrome ─────────────────────────────────────────────────

  /// Square wrapper that hosts an icon in the card header. 30 → 40px.
  iconWrap: "h-[clamp(1.875rem,2.4vw,2.5rem)] w-[clamp(1.875rem,2.4vw,2.5rem)]",
  /// Matching border radius for icon wrappers. 8 → 12px.
  iconWrapRadius: "rounded-[clamp(0.5rem,0.9vw,0.75rem)]",
  /// Icon glyph itself inside the wrapper. 14 → 18px.
  iconSize: "h-[clamp(0.875rem,1.2vw,1.125rem)] w-[clamp(0.875rem,1.2vw,1.125rem)]",
} as const;

/// Shared marquee item width. Used by every AutoHScroller caller so
/// every scrolling card has the same visual footprint regardless of
/// which section it came from.
export const MARQUEE_ITEM_WIDTH = "w-[clamp(170px,20vw,280px)]";

/// Shared marquee gap between cards.
export const MARQUEE_GAP = "gap-[clamp(0.625rem,1.2vw,1.25rem)]";

/// Shared section-header type scale. Every section headline, eyebrow,
/// and body line on the landing page uses these so the page reads as
/// one design, not a grab bag.
export const SECTION = {
  /// Uppercase micro-label chip. 9.6 → 11.2px.
  eyebrow: "text-[clamp(0.6rem,0.85vw,0.7rem)]",
  /// Section H2. 24 → 44px.
  title: "text-[clamp(1.5rem,3.2vw,2.75rem)]",
  /// Section descriptor paragraph. 12.5 → 16px.
  body: "text-[clamp(0.78rem,1.05vw,1rem)]",
} as const;
