import {
  Activity,
  Contact,
  Home,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type PrimaryNavItem = {
  id: "home" | "activity" | "people" | "settings";
  href: string;
  label: string;
  Icon: LucideIcon;
  matchPrefixes?: string[];
};

export const PRIMARY_NAV_ITEMS: PrimaryNavItem[] = [
  {
    id: "home",
    href: "/app/wallet",
    label: "Home",
    Icon: Home,
    matchPrefixes: [
      "/app/wallet/new",
      "/app/proposals",
      "/app/intents",
      "/app/invitations",
      "/app/notifications",
    ],
  },
  {
    id: "activity",
    href: "/app/activity",
    label: "Activity",
    Icon: Activity,
  },
  {
    id: "people",
    href: "/app/contacts",
    label: "People",
    Icon: Contact,
  },
  {
    id: "settings",
    href: "/app/settings",
    label: "Settings",
    Icon: Settings,
    matchPrefixes: [
      "/app/settings",
      "/app/account",
      "/app/secure",
      "/app/security-architecture",
    ],
  },
];

export function isPrimaryNavActive(
  pathname: string | null,
  item: PrimaryNavItem,
): boolean {
  if (!pathname) return false;
  if (pathname === item.href) return true;
  return (item.matchPrefixes ?? []).some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
