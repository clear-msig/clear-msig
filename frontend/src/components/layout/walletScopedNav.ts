import {
  Activity as ActivityIcon,
  ListChecks,
  Users,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react";

export type WalletSubNavItem = {
  sub: string;
  label: string;
  Icon: LucideIcon;
};

export function walletSubNav(): WalletSubNavItem[] {
  return [
    { sub: "", label: "Overview", Icon: WalletIcon },
    { sub: "activity", label: "Activity", Icon: ActivityIcon },
    { sub: "members", label: "People", Icon: Users },
    { sub: "policy", label: "Rules", Icon: ListChecks },
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
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return false;

  const relativePath = pathname.slice(base.length).replace(/^\//, "");
  const firstSegment = relativePath.split("/")[0] ?? "";
  const activeSub =
    firstSegment === "activity"
      ? "activity"
      : firstSegment === "members"
        ? "members"
        : [
              "policy",
              "policies",
              "rules",
              "allowances",
              "budget",
              "settings",
            ].includes(firstSegment)
          ? "policy"
          : "";

  return sub === activeSub;
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
