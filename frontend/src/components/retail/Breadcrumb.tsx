"use client";

// Breadcrumb - a clickable trail showing where the user is.
//
// Replaces the bare "← Wallet" back link on nested pages with the
// full trail (Home → Wallet → Section), each segment a link to its
// own level. Mobile-friendly: trail wraps cleanly, last segment is
// truncated if the wallet name is long. Hidden when there's only one
// segment (no point breadcrumbing the root).
//
// Usage:
//   <Breadcrumb
//     segments={[
//       { label: "Wallets", href: "/app/wallet" },
//       { label: walletName, href: `/app/wallet/${encoded}` },
//       { label: "Members" }, // current page - no href
//     ]}
//   />

import Link from "next/link";
import { ChevronRight } from "lucide-react";

export interface BreadcrumbSegment {
  label: string;
  /// Omit on the last (current) segment so it renders as plain text.
  href?: string;
}

interface BreadcrumbProps {
  segments: BreadcrumbSegment[];
  /// Optional className for layout overrides on the wrapping nav.
  className?: string;
}

export function Breadcrumb({ segments, className }: BreadcrumbProps) {
  if (segments.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      className={"-ml-1 flex items-center text-sm " + (className ?? "")}
    >
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-text-soft">
        {segments.map((seg, i) => {
          const last = i === segments.length - 1;
          return (
            <li key={`${seg.label}-${i}`} className="flex items-center">
              {seg.href && !last ? (
                <Link
                  href={seg.href}
                  className={
                    "rounded-soft px-1.5 py-0.5 transition-colors duration-base ease-out-soft " +
                    "hover:text-text-strong " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                  }
                >
                  {seg.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className={
                    "rounded-soft px-1.5 py-0.5 " +
                    (last ? "font-medium text-text-strong" : "")
                  }
                >
                  {seg.label}
                </span>
              )}
              {!last && (
                <ChevronRight
                  className="h-3.5 w-3.5 text-text-soft/60"
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
