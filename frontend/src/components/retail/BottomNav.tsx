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
import { Home, Plus, UserCircle2, type LucideIcon } from "lucide-react";
import clsx from "clsx";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";

type NavItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
  /// Routes that should mark this item active, in addition to `href`.
  /// Used so "Home" stays highlighted while drilled into a wallet or
  /// a request detail page.
  matchPrefixes?: string[];
  /// Identifier so consumers can attach things like a pending-approvals
  /// badge only to specific tabs (here: Home).
  id?: "home" | "new" | "account";
};

const items: NavItem[] = [
  {
    id: "home",
    href: "/app/wallet",
    label: "Home",
    Icon: Home,
    matchPrefixes: ["/app/wallet", "/app/proposals"],
  },
  { id: "new", href: "/welcome", label: "New", Icon: Plus },
  // "Account" instead of "Settings" so it doesn't read as the same
  // affordance as the wallet hub's per-wallet Settings link. /app/settings
  // is identity + network + sign-out; the wallet's Settings is rules,
  // limits, allowlist, chains.
  { id: "account", href: "/app/settings", label: "Account", Icon: UserCircle2 },
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
  // Multisig-specific signal: how many proposals across all my
  // wallets need MY approval right now? The badge sits on the Home
  // tab because the dashboard is where the full ActionNeeded list
  // already renders. Capped at 9+ for layout stability.
  const { rows: actionRows } = useActionNeeded();
  const pendingCount = actionRows.length;

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
          const showBadge = item.id === "home" && pendingCount > 0;
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={
                  showBadge
                    ? `${item.label} — ${pendingCount} ${
                        pendingCount === 1 ? "request needs" : "requests need"
                      } your approval`
                    : item.label
                }
                className={clsx(
                  "flex min-h-tap-lg flex-col items-center justify-center gap-1 px-2 py-2",
                  "transition-colors duration-base ease-out-soft",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset",
                  active
                    ? "text-accent"
                    : "text-text-soft hover:text-text-strong",
                )}
              >
                <span className="relative inline-flex">
                  <item.Icon
                    className="h-5 w-5"
                    aria-hidden="true"
                    strokeWidth={2}
                  />
                  {showBadge && (
                    <span
                      aria-hidden="true"
                      className={clsx(
                        "absolute -right-1.5 -top-1 inline-flex h-4 min-w-[1rem] items-center justify-center",
                        "rounded-full bg-warning px-1 text-[10px] font-semibold leading-none text-white",
                        "ring-2 ring-canvas",
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
        })}
      </ul>
    </nav>
  );
}
