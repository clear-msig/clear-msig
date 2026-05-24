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
import { useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Bell, ChevronLeft, LogOut } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { useNotificationFeed } from "@/lib/hooks/useNotificationFeed";
import { avatarGradient } from "@/lib/retail/avatar";
import { getSectionLabel } from "@/lib/retail/sectionLabel";

const ROOT_ROUTES = new Set([
  "/app/wallet",
  "/app/notifications",
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
  if (pathname.startsWith("/app/notifications")) return "/app/notifications";
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

      {/* Top-right - wallet connection state. Search + New moved to
          the sidebar (BrandRow's WorkspaceActions). The header now
          owns the connect / disconnect surface so it sits at eye
          level instead of buried in the sidebar footer. */}
      <div className="ml-auto flex items-center gap-2">
        {!pathname.startsWith("/app/notifications") && (
          <HeaderNotificationsButton />
        )}
        <HeaderWalletPill />
      </div>
    </header>
  );
}

function HeaderNotificationsButton() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const { unreadCount } = useNotificationFeed(address);

  if (!wallet.connected || !address) return null;

  const label = unreadCount
    ? `Notifications (${unreadCount} unread)`
    : "Notifications";

  return (
    <Link
      href="/app/notifications"
      aria-label={label}
      className={clsx(
        "relative inline-flex h-8 w-8 items-center justify-center rounded-soft",
        "border border-border-soft bg-glass-soft text-text-soft",
        "transition-[border-color,color,background-color] duration-base ease-out-soft",
        "hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
      )}
    >
      <Bell size={14} aria-hidden="true" />
      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className={clsx(
            "absolute -right-1 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center",
            "rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-text-on-accent",
            "ring-2 ring-canvas",
          )}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </Link>
  );
}

// ─── Header wallet pill ───────────────────────────────────────────
//
// Compact connect / connected state for the desktop top header.
// Shows an avatar + short address + disconnect icon when connected;
// falls back to a "Sign in" link otherwise (defensive - useWalletGate
// already redirects unauthenticated users out of /app/*, so this
// branch should only render in the brief mount-before-gate window).

function HeaderWalletPill() {
  const wallet = useWallet();
  const queryClient = useQueryClient();
  const address = wallet.publicKey?.toBase58() ?? "";

  if (!wallet.connected || !address) {
    return (
      <Link
        href="/connect"
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-soft border border-border-soft bg-glass-soft px-3 py-1.5 text-xs font-medium text-text-soft",
          "transition-[border-color,color] duration-base ease-out-soft hover:border-accent hover:text-accent",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        Sign in
        <ArrowRight size={12} aria-hidden="true" />
      </Link>
    );
  }

  const grad = avatarGradient(address);
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;

  const handleDisconnect = async () => {
    try {
      await wallet.disconnect();
    } catch {
      /* swallow - we still want the cache wipe to land */
    }
    queryClient.clear();
    if (typeof window !== "undefined") {
      window.location.replace("/");
    }
  };

  return (
    <div className="flex items-center gap-1.5 rounded-soft border border-border-soft bg-glass-soft pl-1.5 pr-1 py-1 backdrop-blur-md">
      <span
        aria-hidden="true"
        className={clsx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br shadow-sm",
          grad.from,
          grad.to,
        )}
      >
        <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
      </span>
      <span className="font-mono text-[11px] text-text-strong">{short}</span>
      <button
        type="button"
        onClick={handleDisconnect}
        aria-label="Disconnect wallet"
        title="Disconnect wallet"
        className={clsx(
          "flex h-6 w-6 shrink-0 items-center justify-center rounded text-text-soft",
          "transition-colors duration-base ease-out-soft hover:bg-rose-500/10 hover:text-rose-500",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
        )}
      >
        <LogOut size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
