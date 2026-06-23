import {
  Activity as ActivityIcon,
  Bot,
  Building2,
  ListChecks,
  Search,
  ShieldCheck,
  Users,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react";
import type { WalletProductSurface } from "@/lib/productWorkspace";

export type WalletSubNavItem = {
  sub: string;
  label: string;
  Icon: LucideIcon;
};

export function walletSubNav(
  surface: WalletProductSurface | null,
): WalletSubNavItem[] {
  if (surface === "personal") {
    return [
      { sub: "", label: "Overview", Icon: WalletIcon },
      { sub: "members", label: "People", Icon: Users },
      { sub: "policy", label: "Protection", Icon: ShieldCheck },
      { sub: "activity", label: "Activity", Icon: ActivityIcon },
    ];
  }
  if (surface === "pro") {
    return [
      { sub: "", label: "Treasury", Icon: Building2 },
      { sub: "members", label: "Team", Icon: Users },
      { sub: "policy", label: "Protection", Icon: ShieldCheck },
      { sub: "activity", label: "Activity", Icon: ActivityIcon },
    ];
  }
  if (surface === "agent") {
    return [
      { sub: "agents", label: "Overview", Icon: Bot },
      { sub: "agents/library", label: "Traders", Icon: Search },
      { sub: "agents/policy", label: "Rules", Icon: ShieldCheck },
      { sub: "agents/trades", label: "Trades", Icon: ActivityIcon },
    ];
  }
  return [
    { sub: "", label: "Overview", Icon: WalletIcon },
    { sub: "members", label: "People", Icon: Users },
    { sub: "policy", label: "Protection", Icon: ListChecks },
    { sub: "activity", label: "Activity", Icon: ActivityIcon },
  ];
}

export function walletNavHref(base: string, sub: string): string {
  return sub ? `${base}/${sub}` : base;
}

export function isWalletNavActive(
  pathname: string,
  base: string,
  sub: string,
): boolean {
  const href = walletNavHref(base, sub);
  if (pathname === href) return true;
  if (sub === "policy" && pathname.startsWith(`${base}/policies`)) {
    return true;
  }
  if (sub) return pathname.startsWith(`${href}/`);
  return false;
}

export function activeWalletSlugFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/app\/wallet\/([^/]+)/);
  if (!match?.[1]) return null;
  if (match[1] === "new") return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}
