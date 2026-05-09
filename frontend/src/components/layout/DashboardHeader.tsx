"use client";

// Desktop top header - back navigation for the workspace shell.
//
// Sits above the scrollable content column on md+, hidden on mobile.
// Primary navigation (Home / Activity / Contacts / Settings) lives in
// the sidebar; this header is dedicated to back-navigation context: a
// back button that returns the user to where they came from, plus a
// short label of the current section so the page identity is always
// readable.
//
// Back-button behavior:
//   • If the user has navigated within the app this session,
//     router.back() walks browser history (preserving scroll, query
//     params, intermediate steps).
//   • If they landed directly on a deep route (cold link, refresh),
//     getParentRoute() falls back to a sensible parent so back never
//     ejects the user out of the app.

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import clsx from "clsx";
import { ChevronLeft, Plus, Search } from "lucide-react";
import { openCommandPalette } from "@/components/layout/CommandPalette";
import { getSectionLabel } from "@/lib/retail/sectionLabel";

const ROOT_ROUTES = new Set([
  "/app/wallet",
  "/app/activity",
  "/app/contacts",
  "/app/account",
  "/app/settings",
]);

function getParentRoute(pathname: string): string {
  if (!pathname.startsWith("/app/")) return "/app/wallet";
  // Detail-page drill-downs always live under Home.
  if (
    pathname.startsWith("/app/proposals") ||
    pathname.startsWith("/app/intents") ||
    pathname.startsWith("/app/invitations")
  ) {
    return "/app/wallet";
  }
  if (pathname.startsWith("/app/settings/")) return "/app/settings";
  if (pathname.startsWith("/app/account/")) return "/app/account";
  // Walk one segment up; if we'd land at /app or /app/, go to /app/wallet.
  const segs = pathname.split("/").filter(Boolean);
  if (segs.length <= 2) return "/app/wallet";
  return "/" + segs.slice(0, -1).join("/");
}

export function DashboardHeader() {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  // Track in-app navigations so router.back() only fires when it'll
  // actually land somewhere in our app. Mount counts as 1; each
  // pathname change increments. count > 1 ⇒ at least one in-app jump
  // has happened ⇒ history.back() is safe.
  const navCountRef = useRef(0);
  useEffect(() => {
    navCountRef.current += 1;
  }, [pathname]);

  const isRoot = ROOT_ROUTES.has(pathname);
  const label = getSectionLabel(pathname);

  const handleBack = () => {
    if (navCountRef.current > 1) {
      router.back();
    } else {
      router.push(getParentRoute(pathname));
    }
  };

  return (
    <header
      role="banner"
      className={clsx(
        "hidden h-14 shrink-0 items-center gap-3 px-6 md:flex lg:px-8 xl:px-10",
        "border-b border-border-soft bg-canvas/80 backdrop-blur-xl",
      )}
    >
      {!isRoot ? (
        <button
          type="button"
          onClick={handleBack}
          aria-label="Go back"
          className={clsx(
            "group inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-glass-soft py-1.5 pl-2 pr-3 text-xs font-medium text-text-soft",
            "transition-colors duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <ChevronLeft
            size={14}
            className="transition-transform duration-base group-hover:-translate-x-0.5"
            aria-hidden="true"
          />
          <span>Back</span>
        </button>
      ) : null}
      {!isRoot && label ? (
        <span
          aria-hidden="true"
          className="h-5 w-px shrink-0 bg-glass-strong"
        />
      ) : null}
      {label ? (
        <h1 className="truncate font-display text-sm font-semibold tracking-tight text-text-strong">
          {label}
        </h1>
      ) : null}

      {/* Top-right actions - global Search trigger + New shared wallet
          CTA. ml-auto pushes the cluster against the right edge so it
          stays anchored regardless of how long the section label runs. */}
      <div className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onClick={() => openCommandPalette()}
          aria-label="Search (⌘K)"
          className={clsx(
            "group inline-flex items-center gap-2 rounded-soft border border-border-soft bg-glass-soft px-2.5 py-1.5 text-xs text-text-soft",
            "transition-colors duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Search size={13} aria-hidden="true" />
          <span className="hidden lg:inline">Search</span>
          <kbd className="hidden rounded border border-border-soft bg-glass-soft px-1.5 py-0.5 font-mono text-[10px] text-text-soft lg:inline">
            ⌘K
          </kbd>
        </button>
        <Link
          href="/app/wallet/new"
          aria-label="New shared wallet"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 py-1.5 text-xs font-medium text-text-on-accent shadow-accent-rest",
            "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
            "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Plus size={13} aria-hidden="true" />
          <span>New</span>
        </Link>
      </div>
    </header>
  );
}
