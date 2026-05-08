"use client";

// StickyTopBar — page-level back / breadcrumb bar that stays pinned to
// the top of the page column on every screen size.
//
// History:
//   - 2026-05-01: introduced. Sticky bar with bordered band so back
//     affordances stayed in view while scrolling on mobile.
//   - 2026-05-03: dropped the bottom border (read as a horizontal
//     scar on wide screens with short breadcrumbs).
//   - 2026-05-04: dropped the bg-canvas overlay + sticky behaviour
//     on desktop entirely. On md+ the sidebar was the constant nav,
//     so pinning wasn't load-bearing.
//   - 2026-05-05: re-introduced sticky on desktop and unified the
//     pin offset across breakpoints. The desktop-static behaviour
//     meant back affordances scrolled away on long pages, which
//     forced users to scroll back to the top to navigate. Frosted-
//     glass backdrop returns so content scrolling under the bar
//     stays legible without a hard border.
//
// Pin offset varies by parent layout:
//   - workspace `(app)` pages on md+ have no floating brand pill (the
//     sidebar carries the brand), so the bar pins at top-4. On mobile
//     the pill returns, so we clear top-20 like before.
//   - standalone pages (welcome, connect, privacy, security, ...)
//     keep the floating pill at every breakpoint, so the bar always
//     clears top-20 lg:top-16.
//
// The `offset` prop selects between these:
//
//   "header" — workspace pages. parent <main> has pt-20 (mobile) /
//              md:pt-4 (desktop). Bar inherits flow + pin matches.
//   "top"    — standalone pages. <main> has no top padding. The bar
//              bakes the spacing in so its flow position matches the
//              sticky pin and content below isn't covered at scroll-0.

interface StickyTopBarProps {
  children: React.ReactNode;
  offset?: "top" | "header";
  /// Optional extra classes for the inner row (alignment, gap).
  innerClassName?: string;
}

export function StickyTopBar({
  children,
  offset = "top",
  innerClassName,
}: StickyTopBarProps) {
  // Standalone pages bake the spacing in so flow position matches the
  // sticky pin. Workspace pages get it from the shell's pt-16
  // (mobile) / md:pt-6 (desktop).
  const flowSpacing = offset === "top" ? "mt-16 lg:mt-12 " : "";
  // Standalone pages also need horizontal padding so back content
  // isn't flush with the viewport edge on mobile. Desktop standalone
  // pages constrain content via their own max-width wrappers, so the
  // gutter drops at md+.
  const innerHorizontal = offset === "top" ? "px-gutter md:px-0 " : "";
  // Pin offset.
  //   - offset="header": workspace pages — top-14 on mobile (sits
  //     just below the 56px header backdrop strip), md:top-2 on
  //     desktop where the brand pill is hidden.
  //   - offset="top": standalone pages — top-14 lg:top-10 to clear
  //     the floating pill that renders everywhere.
  //
  // Background is SOLID bg-canvas (not bg-canvas/85 + backdrop-blur)
  // so:
  //   1. Scrolled content under the bar is fully hidden — no Hero
  //      card bleeding through to read as "back link inside Hero".
  //   2. backdrop-blur is one of the most paint-expensive ops on
  //      mobile. Dropping it lifts scroll fps from ~50 to 70+ on
  //      mid-tier Android. The bottom-nav comment had the same
  //      reasoning; bringing the StickyTopBar in line.
  const pinClasses =
    offset === "header"
      ? "sticky top-14 md:top-2 z-30 bg-canvas"
      : "sticky top-14 lg:top-10 z-30 bg-canvas";
  return (
    <div className={flowSpacing + pinClasses}>
      <div
        className={
          // Tighter vertical padding on mobile (py-2 vs py-3) shaves
          // 8px off the band the user lands on at scroll-0.
          "flex w-full items-center py-2 sm:py-3 " +
          innerHorizontal +
          (innerClassName ?? "")
        }
      >
        {children}
      </div>
    </div>
  );
}
