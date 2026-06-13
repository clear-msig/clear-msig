// BottomNav - mobile-first primary navigation.
//
// Four flat tabs (Home / Activity / Contacts / Account) flanking a
// centered floating-action button for "New wallet".
//
// The FAB visually "cuts apart" from the bar via a `ring-[6px]
// ring-canvas` halo: the ring matches the page background, so where
// the FAB overlaps the bar surface (which is bg-surface-raised, one
// step elevated), the ring punches a clean circular cutout. Above the
// bar the ring blends with the page canvas and disappears, so the
// only visible chrome is the accent puck itself, raised on a
// brand-tinted shadow.
//
// Hidden md+ - desktop has the persistent sidebar.
// Safe-area: `pb-safe-bottom` adds the iOS home-indicator inset so
// taps near the bottom don't sit under the system gesture area.

"use client";

import { useEffect, useState, type MouseEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Contact,
  Home,
  Plus,
  Settings,
  type LucideIcon,
} from "lucide-react";
import clsx from "clsx";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { getWalletAppearance } from "@/lib/retail/walletAppearance";
import { walletProductSurface } from "@/lib/productWorkspace";
import { productSetupHref } from "@/lib/productSurfaces";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  activeWalletSlugFromPathname,
  isWalletNavActive,
  walletNavHref,
  walletSubNav,
} from "@/components/layout/walletScopedNav";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /// Routes that should mark this item active, in addition to `href`.
  /// "Home" stays highlighted while drilled into a wallet or proposal.
  matchPrefixes?: string[];
  id?: "home" | "activity" | "contacts" | "settings";
};

const navItems: NavItem[] = [
  {
    id: "home",
    href: "/app/wallet",
    label: "Home",
    Icon: Home,
    matchPrefixes: [
      "/app/wallet",
      "/app/proposals",
      "/app/intents",
      "/app/invitations",
    ],
  },
  {
    id: "activity",
    href: "/app/activity",
    label: "Activity",
    Icon: Activity,
  },
  {
    id: "contacts",
    href: "/app/contacts",
    label: "Contacts",
    Icon: Contact,
  },
  {
    id: "settings",
    href: "/app/settings",
    label: "Settings",
    Icon: Settings,
    // Account is a separate destination reachable from the top-right
    // header chip on the Settings page. The Settings tab should NOT
    // light up while on Account - the two are sibling surfaces, not
    // one-inside-the-other.
    matchPrefixes: ["/app/settings"],
  },
];

function isActive(pathname: string | null, item: NavItem): boolean {
  if (!pathname) return false;
  if (pathname === item.href) return true;
  for (const p of item.matchPrefixes ?? []) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true;
  }
  return false;
}

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [launchingCreate, setLaunchingCreate] = useState(false);
  const currentPathname = pathname ?? "";
  // Multisig-specific signal: how many proposals across all my wallets
  // need MY approval right now? The badge sits on the Home tab because
  // the dashboard renders the full ActionNeeded list. Capped at 9+
  // for layout stability.
  const { rows: actionRows } = useActionNeeded();
  const pendingCount = actionRows.length;

  // Two tabs flank each side of the FAB spacer.
  const leftItems = navItems.slice(0, 2);
  const rightItems = navItems.slice(2);
  const createHref = "/app/wallet/new";
  const activeWalletSlug = activeWalletSlugFromPathname(currentPathname);
  useEffect(() => {
    setLaunchingCreate(false);
  }, [pathname]);

  const handleCreateClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (pathname === createHref || launchingCreate) return;
    event.preventDefault();
    setLaunchingCreate(true);
    window.setTimeout(() => {
      router.push(createHref);
    }, 260);
  };

  if (activeWalletSlug) {
    return (
      <WalletScopedBottomNav
        slug={activeWalletSlug}
        pathname={currentPathname}
      />
    );
  }

  return (
    <nav
      aria-label="Primary"
      className={clsx(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        // Bar surface - one step lifted off the page canvas so the
        // FAB's ring-canvas halo reads as a real circular cutout.
        "border-t border-border-soft bg-surface-raised",
        // 12px rounded top corners - gives the bar a friendly,
        // floating-pill feel and softens the meeting point with
        // page content scrolling beneath.
        "rounded-t-xl",
        "pb-safe-bottom",
        // Subtle top-edge highlight gives the bar physical presence
        // without a heavy shadow that'd compete with the FAB.
        "shadow-[0_-1px_0_0_rgba(255,255,255,0.04)_inset]",
      )}
    >
      {/* Centered FAB - primary "+" CTA. Raised above the bar with a
          ring-canvas halo for the cutout effect; brand accent shadow
          anchors it to the palette. */}
      <Link
        href={createHref}
        onClick={handleCreateClick}
        aria-label="Create a new wallet"
        className={clsx(
          "absolute left-1/2 -top-7 z-10 -translate-x-1/2",
          "flex h-14 w-14 items-center justify-center rounded-full",
          "bg-accent text-text-on-accent",
          // The halo: 6px of canvas-colored ring carves the FAB out
          // of the bar surface and disappears against the page above.
          "ring-[6px] ring-canvas",
          // Brand-tinted lift. The accent-rest token stays subtle at
          // rest; -hover bumps the spread on touch.
          "shadow-accent-rest",
          "transition-[transform,box-shadow] duration-base ease-out-soft",
          "hover:scale-[1.04] hover:shadow-accent-hover active:scale-95",
          "focus-visible:outline-none focus-visible:shadow-accent-hover",
          launchingCreate && "scale-[1.08] shadow-accent-hover",
        )}
      >
        <Plus
          className={clsx(
            "h-6 w-6 transition-transform duration-300 ease-out-soft",
            launchingCreate && "rotate-180 scale-110",
          )}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </Link>

      <ul className="flex items-stretch">
        {leftItems.map((item) => (
          <NavTab
            key={item.href}
            item={item}
            pathname={pathname}
            pendingCount={pendingCount}
          />
        ))}
        {/* Spacer reserves room for the FAB so tab widths don't
            jostle. Width = FAB outer diameter (56px + 12px ring) +
            breathing room. */}
        <li aria-hidden="true" className="w-20 shrink-0" />
        {rightItems.map((item) => (
          <NavTab
            key={item.href}
            item={item}
            pathname={pathname}
            pendingCount={pendingCount}
          />
        ))}
      </ul>
    </nav>
  );
}

function WalletScopedBottomNav({
  slug,
  pathname,
}: {
  slug: string;
  pathname: string;
}) {
  const router = useRouter();
  const [launchingCreate, setLaunchingCreate] = useState(false);
  const base = `/app/wallet/${encodeURIComponent(slug)}`;
  const surface = walletProductSurface(getWalletAppearance(slug)?.surface);
  const items = walletSubNav(surface).filter(
    (item) => item.sub !== "members" && item.sub !== "policy",
  );
  const display = toDisplayName(slug);
  const createHref = surface ? productSetupHref(surface) : "/app/wallet/new";
  const createLabel = surface
    ? `Create another ${surface} wallet`
    : "Create a new wallet";
  const splitIndex = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, splitIndex);
  const rightItems = items.slice(splitIndex);

  useEffect(() => {
    setLaunchingCreate(false);
  }, [pathname]);

  const handleCreateClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (launchingCreate) return;
    event.preventDefault();
    setLaunchingCreate(true);
    window.setTimeout(() => {
      router.push(createHref);
    }, 260);
  };

  return (
    <nav
      aria-label={`${display} wallet navigation`}
      className={clsx(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        "border-t border-border-soft bg-surface-raised",
        "rounded-t-xl pb-safe-bottom",
        "shadow-[0_-1px_0_0_rgba(255,255,255,0.04)_inset]",
      )}
    >
      <Link
        href={createHref}
        onClick={handleCreateClick}
        aria-label={createLabel}
        className={clsx(
          "absolute left-1/2 -top-7 z-10 -translate-x-1/2",
          "flex h-14 w-14 items-center justify-center rounded-full",
          "bg-accent text-text-on-accent ring-[6px] ring-canvas shadow-accent-rest",
          "transition-[transform,box-shadow] duration-base ease-out-soft",
          "hover:scale-[1.04] hover:shadow-accent-hover active:scale-95",
          "focus-visible:outline-none focus-visible:shadow-accent-hover",
          launchingCreate && "scale-[1.08] shadow-accent-hover",
        )}
      >
        <Plus
          className={clsx(
            "h-6 w-6 transition-transform duration-300 ease-out-soft",
            launchingCreate && "rotate-180 scale-110",
          )}
          strokeWidth={2.5}
          aria-hidden="true"
        />
      </Link>
      <ul className="flex items-stretch gap-1 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {leftItems.map((item) => {
          const href = walletNavHref(base, item.sub);
          const active = isWalletNavActive(pathname, base, item.sub);
          return (
            <li key={item.sub || "overview"} className="min-w-[76px] flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={clsx(
                  "relative flex min-h-tap-lg flex-col items-center justify-center gap-1 rounded-soft px-2 py-2",
                  "transition-colors duration-base ease-out-soft",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 h-1 w-1 rounded-full bg-accent"
                  />
                ) : null}
                <item.Icon
                  className="h-5 w-5"
                  strokeWidth={active ? 2.25 : 2}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate text-[10px] font-medium leading-none">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
        <li aria-hidden="true" className="w-20 shrink-0" />
        {rightItems.map((item) => {
          const href = walletNavHref(base, item.sub);
          const active = isWalletNavActive(pathname, base, item.sub);
          return (
            <li key={item.sub || "overview"} className="min-w-[76px] flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={clsx(
                  "relative flex min-h-tap-lg flex-col items-center justify-center gap-1 rounded-soft px-2 py-2",
                  "transition-colors duration-base ease-out-soft",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                  active
                    ? "bg-accent/10 text-accent"
                    : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
                )}
              >
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute top-1 h-1 w-1 rounded-full bg-accent"
                  />
                ) : null}
                <item.Icon
                  className="h-5 w-5"
                  strokeWidth={active ? 2.25 : 2}
                  aria-hidden="true"
                />
                <span className="max-w-full truncate text-[10px] font-medium leading-none">
                  {item.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function NavTab({
  item,
  pathname,
  pendingCount,
}: {
  item: NavItem;
  pathname: string | null;
  pendingCount: number;
}) {
  const active = isActive(pathname, item);
  const showBadge = item.id === "home" && pendingCount > 0;
  return (
    <li className="flex-1">
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        aria-label={
          showBadge
            ? `${item.label} - ${pendingCount} ${
                pendingCount === 1 ? "request needs" : "requests need"
              } your approval`
            : item.label
        }
        className={clsx(
          "relative flex min-h-tap-lg flex-col items-center justify-center gap-1 px-2 py-2",
          "transition-colors duration-base ease-out-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
          active ? "text-accent" : "text-text-soft hover:text-text-strong",
        )}
      >
        {/* Active-tab indicator - a tiny accent dot at the very top
            edge of the tab. Lighter than a tinted background pill,
            and pairs cleanly with the accent FAB so the brand colour
            shows up consistently across the bar. */}
        {active && (
          <span
            aria-hidden="true"
            className="absolute top-1 h-1 w-1 rounded-full bg-accent"
          />
        )}
        <span className="relative inline-flex">
          <item.Icon
            className="h-5 w-5"
            strokeWidth={active ? 2.25 : 2}
            aria-hidden="true"
          />
          {showBadge && (
            <span
              aria-hidden="true"
              className={clsx(
                "absolute -right-1.5 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center",
                "rounded-full bg-warning px-1 text-[10px] font-semibold leading-none text-white",
                "ring-2 ring-surface-raised",
              )}
            >
              {pendingCount > 9 ? "9+" : pendingCount}
            </span>
          )}
        </span>
        <span className="text-[11px] font-medium leading-none">
          {item.label}
        </span>
      </Link>
    </li>
  );
}
