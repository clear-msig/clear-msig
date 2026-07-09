import type { ProductSurfaceId } from "@/lib/productSurfaces";
import { getWalletAppearance } from "@/lib/retail/walletAppearance";
import { toDisplayName } from "@/lib/retail/walletNames";

export type WalletProductSurface = Extract<
  ProductSurfaceId,
  "personal" | "pro" | "agent" | "secure"
>;

export function walletProductSurface(
  value: ProductSurfaceId | null | undefined,
): WalletProductSurface | null {
  return value === "personal" ||
    value === "pro" ||
    value === "agent" ||
    value === "secure"
    ? value
    : null;
}

export function resolveWalletProductSurface(
  walletName: string,
  fallback?: ProductSurfaceId | WalletProductSurface | null,
): WalletProductSurface | null {
  const stored = walletProductSurface(getWalletAppearance(walletName)?.surface);
  if (stored) return stored;

  const fallbackSurface = walletProductSurface(fallback);
  if (fallbackSurface) return fallbackSurface;

  const name = toDisplayName(walletName).toLowerCase();
  if (/\b(agent|trading|trade|desk)\b/.test(name)) return "agent";
  if (/\b(pro|team|treasury|studio|company|business|dao|multisig|nexus)\b/.test(name)) {
    return "pro";
  }
  if (/\b(personal|family|couple|roommates|home|my wallet)\b/.test(name)) {
    return "personal";
  }
  if (/\b(secure|recovery|recover|vault)\b/.test(name)) return "secure";

  return null;
}

export type WalletProductSurfaceSource = {
  wallet_name?: string | null;
};

export function walletProductSurfaceCounts(
  wallets: readonly WalletProductSurfaceSource[],
): Map<WalletProductSurface, number> {
  const counts = new Map<WalletProductSurface, number>();
  for (const wallet of wallets) {
    const surface = resolveWalletProductSurface(wallet.wallet_name ?? "");
    if (!surface) continue;
    counts.set(surface, (counts.get(surface) ?? 0) + 1);
  }
  return counts;
}

export function filterWalletsByProductSurface<
  Wallet extends WalletProductSurfaceSource,
>(
  wallets: readonly Wallet[],
  surface: WalletProductSurface | null,
): Wallet[] {
  if (!surface) return [...wallets];
  return wallets.filter(
    (wallet) => resolveWalletProductSurface(wallet.wallet_name ?? "") === surface,
  );
}

export function productWorkspaceLabel(surface: WalletProductSurface | null): string {
  switch (surface) {
    case "personal":
      return "Personal wallet";
    case "pro":
      return "Pro treasury";
    case "agent":
      return "Agent vault";
    case "secure":
      return "Secure recovery";
    default:
      return "Active wallet";
  }
}

export function productWorkspaceHomeHref(
  walletName: string,
  surface: WalletProductSurface | null,
): string {
  const encoded = encodeURIComponent(walletName);
  if (surface === "agent") return `/app/wallet/${encoded}/agents`;
  if (surface === "secure") return "/app/secure";
  return `/app/wallet/${encoded}`;
}

export function productWorkspaceRedirectHref({
  walletName,
  surface,
  pathname,
}: {
  walletName: string;
  surface: WalletProductSurface | null;
  pathname: string;
}): string | null {
  if (!surface) return null;
  const base = `/app/wallet/${encodeURIComponent(walletName)}`;
  if (surface === "agent") {
    if (pathname === base) return `${base}/agents`;
    if (pathname === `${base}/policy` || pathname.startsWith(`${base}/policy/`)) {
      return `${base}/agents/policy`;
    }
    if (pathname === `${base}/rules` || pathname.startsWith(`${base}/rules/`)) {
      return `${base}/agents/policy`;
    }
    if (pathname === `${base}/budget` || pathname.startsWith(`${base}/budget/`)) {
      return `${base}/agents/funding`;
    }
    if (pathname === `${base}/allowances` || pathname.startsWith(`${base}/allowances/`)) {
      return `${base}/agents/sessions/new`;
    }
    return isAllowedAgentPath(pathname, base) ? null : `${base}/agents`;
  }
  if (surface === "personal") {
    return isAllowedPersonalPath(pathname, base) ? null : base;
  }
  if (surface === "pro") {
    if (pathname === `${base}/rules` || pathname.startsWith(`${base}/rules/`)) {
      return `${base}/policy`;
    }
    return isAllowedProPath(pathname, base) ? null : base;
  }
  if (surface === "secure") {
    return pathname === base || pathname.startsWith(`${base}/secure`)
      ? "/app/secure"
      : null;
  }
  return null;
}

function isAllowedAgentPath(pathname: string, base: string): boolean {
  return (
    pathname === `${base}/agents` ||
    pathname.startsWith(`${base}/agents/`) ||
    pathname === `${base}/chains` ||
    pathname.startsWith(`${base}/chains/`) ||
    pathname === `${base}/swap` ||
    pathname === `${base}/activity` ||
    pathname === `${base}/settings`
  );
}

function isAllowedPersonalPath(pathname: string, base: string): boolean {
  const allowed = [
    "",
    "activity",
    "members",
    "members/add",
    "chains",
    "chains/add",
    "policy",
    "rules",
    "budget",
    "send",
    "send/batch",
    "send/btc",
    "send/erc20",
    "send/eth",
    "send/zec",
    "swap",
    "receive",
    "buy",
    "sell",
    "setup",
    "setup/erc20",
    "setup/eth",
    "settings",
  ];
  return allowed.some((sub) => {
    const href = sub ? `${base}/${sub}` : base;
    if (!sub) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  });
}

function isAllowedProPath(pathname: string, base: string): boolean {
  const allowed = [
    "",
    "activity",
    "members",
    "members/add",
    "chains",
    "chains/add",
    "policy",
    "policies",
    "budget",
    "escrow",
    "send",
    "send/batch",
    "send/btc",
    "send/erc20",
    "send/eth",
    "send/zec",
    "swap",
    "receive",
    "buy",
    "sell",
    "setup",
    "setup/erc20",
    "setup/eth",
    "settings",
  ];
  return allowed.some((sub) => {
    const href = sub ? `${base}/${sub}` : base;
    if (!sub) return pathname === href;
    return pathname === href || pathname.startsWith(`${href}/`);
  });
}
