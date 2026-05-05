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
// Pin offset (`top-20 lg:top-16`) matches the workspace shell's
// `pt-20 lg:pt-16` and the persistent sidebar's `top-20 lg:top-16`,
// so on desktop the bar's top edge aligns with the sidebar's top
// edge, and on every viewport it clears the floating HeaderBar pill
// (`top-3 sm:top-4`, ~40px tall).
//
// The `offset` prop reflects how the parent layout reserves top
// space, not where the bar pins:
//
//   "header" — pages inside the workspace `(app)` layout, whose
//              parent <main> already has `pt-20 lg:pt-16`. The bar
//              inherits that flow position; no extra margin needed.
//   "top"    — standalone pages (welcome, connect, privacy,
//              security, full-bleed receive/setup/setup-eth) whose
//              <main> has no top padding. The bar adds its own
//              margin so its flow position matches the sticky pin
//              and content right below it isn't visually covered
//              at scroll-0.
//
// Both modes pin at the same viewport offset.

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
  // sticky pin. Workspace pages already have it from the shell's
  // `pt-20 lg:pt-16`.
  const flowSpacing = offset === "top" ? "mt-20 lg:mt-16 " : "";
  // Standalone pages also need horizontal padding so back content
  // isn't flush with the viewport edge on mobile. Desktop standalone
  // pages constrain content via their own max-width wrappers, so the
  // gutter drops at md+.
  const innerHorizontal = offset === "top" ? "px-gutter md:px-0 " : "";
  return (
    <div
      className={
        flowSpacing +
        "sticky top-20 lg:top-16 z-30 bg-canvas/85 backdrop-blur-md"
      }
    >
      <div
        className={
          "flex w-full items-center py-3 " +
          innerHorizontal +
          (innerClassName ?? "")
        }
      >
        {children}
      </div>
    </div>
  );
}
