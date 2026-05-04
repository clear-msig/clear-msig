"use client";

// StickyTopBar. The page-level back-and-context strip that stays in
// view as the user scrolls.
//
// History:
//   - 2026-05-01: introduced. Sticky bar with bordered band so back
//     affordances stayed in view while scrolling on mobile.
//   - 2026-05-03: dropped the bottom border (read as a horizontal
//     scar on wide screens with short breadcrumbs).
//   - 2026-05-04: dropped the bg-canvas overlay + sticky behaviour
//     on desktop entirely. The "band" reading was the bg + the
//     pinned position; on md+ the sidebar is the constant nav so
//     pinning isn't load-bearing. On mobile we keep sticky.
//
// Pages drop their existing header content (back link, breadcrumb,
// or any combination) inside this wrapper. Same API both sides.
//
// Use `offset="header"` on pages rendered inside the workspace
// `(app)` layout, where the floating HeaderBar already occupies the
// top of the viewport. On standalone pages (welcome, connect,
// privacy, contacts, proposals) the default `offset="top"` is right.

interface StickyTopBarProps {
  children: React.ReactNode;
  /// Where to stick. "top" pins to the viewport; "header" pins below
  /// the floating HeaderBar (workspace pages). Defaults to "top".
  offset?: "top" | "header";
  /// Optional extra classes for the inner row (alignment, gap).
  innerClassName?: string;
}

export function StickyTopBar({
  children,
  offset = "top",
  innerClassName,
}: StickyTopBarProps) {
  // No visible band, anywhere. The user kept calling out the
  // amber-tinted strip that sat above content; on 2026-05-04 they
  // asked for it gone on mobile too. Sticky position stays on
  // mobile so the breadcrumb doesn't scroll out of view, but the
  // bg overlay drops everywhere — the sticky element is now an
  // invisible container that re-pins the breadcrumb without painting
  // anything behind it.
  const positioning =
    offset === "header"
      ? "sticky top-20 sm:top-24 md:static md:top-auto"
      : "sticky top-0 px-gutter md:static md:top-auto md:px-0";
  return (
    <div
      className={
        positioning +
        " z-30 py-2 md:py-0"
      }
    >
      <div
        className={
          "flex w-full items-center " + (innerClassName ?? "")
        }
      >
        {children}
      </div>
    </div>
  );
}
