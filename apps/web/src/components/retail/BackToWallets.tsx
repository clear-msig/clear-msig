"use client";

// BackToWallets - compact back-link chip rendered above the Hero
// on mobile workspace subpages. The full StickyTopBar (breadcrumb)
// was killed on mobile because it ate ~56px of above-fold space
// to show chrome the BottomNav already covers - but the user
// pointed out that once you're inside a subpage like /send or
// /policies there's no obvious in-page affordance to bounce out.
//
// This chip is the lightweight replacement: a single 44px-tall
// pill (Apple HIG minimum) that sits just above the page's Hero,
// links straight to the app resolver, and reads as "navigation crumb"
// without the full-width band of the original StickyTopBar.
// Was h-9 (36px) until 2026-05-08; bumped to h-11 (44px) to clear
// the HIG minimum exactly. Visual weight stays "chip" because of
// rounded-full + small text - the height bump only changes the
// hit area, not the perceived size.
//
// Hidden on md+ because the desktop sidebar + StickyTopBar
// already cover this case.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function BackToWallets({
  label = "Wallets",
  className,
}: {
  /// Override the link label. Defaults to "Wallets". Pages that
  /// want a more specific name (e.g. "Back to Trial") should
  /// render their own link instead.
  label?: string;
  /// Optional extra classes for layout adjustments per-page.
  className?: string;
}) {
  return (
    <Link
      href="/app"
      aria-label={`Back to ${label}`}
      className={
        "group inline-flex h-11 w-fit items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-4 text-xs font-medium text-text-soft md:hidden " +
        "transition-[border-color,color,transform] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:text-accent " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
        (className ?? "")
      }
    >
      <ArrowLeft
        className="h-3.5 w-3.5 transition-transform duration-base group-hover:-translate-x-0.5"
        aria-hidden="true"
      />
      {label}
    </Link>
  );
}
