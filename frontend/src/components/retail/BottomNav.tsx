// BottomNav — mobile-first primary navigation for the retail surface.
//
// Per the locked plan: bottom nav replaces the header drawer + persistent
// sidebar on mobile. Hidden md+ until the desktop chrome is replaced too
// (then the breakpoint guard goes away). Routes here are placeholders;
// some destinations don't exist yet — wire them up as the screens land.
//
// Safe-area handling: `pb-safe-bottom` adds the iOS home-indicator inset
// so taps near the bottom don't sit under the system gesture area.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Plus, Settings, type LucideIcon } from "lucide-react";
import clsx from "clsx";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /// Routes that should mark this item active, in addition to `href`.
  /// Used so "Home" stays highlighted while drilled into a wallet or
  /// a request detail page.
  matchPrefixes?: string[];
};

const items: NavItem[] = [
  {
    href: "/app/wallet",
    label: "Home",
    Icon: Home,
    matchPrefixes: ["/app/wallet", "/app/proposals"],
  },
  { href: "/welcome", label: "New", Icon: Plus },
  { href: "/app/settings", label: "Settings", Icon: Settings },
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

  return (
    <nav
      aria-label="Primary"
      className={clsx(
        "fixed inset-x-0 bottom-0 z-40 md:hidden",
        // Solid surface (no backdrop-blur) — 70fps budget; blur is paint-expensive on mobile.
        "border-t border-border-soft bg-canvas",
        "pb-safe-bottom",
      )}
    >
      <ul className="flex items-stretch">
        {items.map((item) => {
          const active = isActive(pathname, item);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={clsx(
                  "flex min-h-tap-lg flex-col items-center justify-center gap-1 px-2 py-2",
                  "transition-colors duration-base ease-out-soft",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                  active
                    ? "text-accent"
                    : "text-text-soft hover:text-text-strong",
                )}
              >
                <item.Icon
                  className="h-5 w-5"
                  aria-hidden="true"
                  strokeWidth={2}
                />
                <span className="text-[11px] font-medium leading-none">
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
