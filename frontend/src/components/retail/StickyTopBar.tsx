"use client";

// StickyTopBar. The page-level back-and-context strip that stays in
// view as the user scrolls.
//
// Spectre's 2026-05-01 review flagged that back affordances scrolling
// out of view felt broken across pages. This wrapper standardises the
// fix: position sticky at the top of the visible content area, solid
// canvas background so content underneath is occluded, faint bottom
// border so the bar reads as separated from the body.
//
// Pages drop their existing header content (back link, breadcrumb,
// or any combination) inside this wrapper.
//
//   <StickyTopBar>
//     <Breadcrumb segments={[...]} />
//   </StickyTopBar>
//
//   <StickyTopBar offset="header">
//     <Breadcrumb segments={[...]} />
//   </StickyTopBar>
//
// Use `offset="header"` on pages rendered inside the workspace
// `(app)` layout, where the floating HeaderBar already occupies the
// top of the viewport. On standalone pages (welcome, connect, send,
// privacy, contacts, proposals) the default `offset="top"` is right.
//
// Performance: no backdrop-blur (per the perf budget). Solid bg with
// a subtle alpha so content scrolling under reads as ghosted, not
// hard-cut. No layout-property animations.

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
  const stickClass =
    offset === "header"
      ? "sticky top-20 -mx-3 px-3 sm:top-24 sm:-mx-4 sm:px-4 lg:-mx-6 lg:px-6"
      : "sticky top-0 px-gutter";
  return (
    <div
      className={
        stickClass +
        " z-30 border-b border-border-soft/60 bg-canvas/95 py-3"
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
