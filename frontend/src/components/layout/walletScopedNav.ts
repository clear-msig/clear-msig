import {
  Activity as ActivityIcon,
  Bot,
  Building2,
  Layers,
  ListChecks,
  Plug,
  Search,
  Settings,
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
      { sub: "members", label: "Trusted people", Icon: Users },
      { sub: "policy", label: "Rules", Icon: ListChecks },
      { sub: "activity", label: "Activity", Icon: ActivityIcon },
      { sub: "settings", label: "Settings", Icon: Settings },
    ];
  }
  if (surface === "pro") {
    return [
      { sub: "", label: "Treasury", Icon: Building2 },
      { sub: "members", label: "Team", Icon: Users },
      { sub: "activity", label: "Activity", Icon: ActivityIcon },
      { sub: "chains", label: "Networks", Icon: Layers },
      { sub: "policy", label: "Rules", Icon: ListChecks },
      { sub: "settings", label: "Settings", Icon: Settings },
    ];
  }
  if (surface === "agent") {
    return [
      { sub: "agents", label: "Trading", Icon: Bot },
      { sub: "agents/library", label: "Traders", Icon: Search },
      { sub: "agents/hyperliquid", label: "Venue", Icon: Plug },
      { sub: "agents/policy", label: "Guardrails", Icon: ShieldCheck },
      { sub: "agents/trades", label: "Trades", Icon: ActivityIcon },
      { sub: "settings", label: "Settings", Icon: Settings },
    ];
  }
  return [
    { sub: "", label: "Overview", Icon: WalletIcon },
    { sub: "members", label: "Members", Icon: Users },
    { sub: "activity", label: "Activity", Icon: ActivityIcon },
    { sub: "chains", label: "Networks", Icon: Layers },
    { sub: "policy", label: "Rules", Icon: ListChecks },
    { sub: "settings", label: "Settings", Icon: Settings },
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
