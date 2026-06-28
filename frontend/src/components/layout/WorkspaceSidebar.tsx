"use client";

// Workspace sidebar - light-theme rail with expand-to-full toggle.
//
// History:
//   - 2026-04-30 (locked spec): persistent left rail on desktop, drawer
//     body on mobile. Dark surface (bg-surface-card-strong) + GitHub
//     link in the footer.
//   - 2026-05-05: switched to a light surface (bg-surface-raised) with
//     a subtle right border. Added rail (collapsed) ↔ full (expanded)
//     toggle on desktop. Removed GitHub link from the footer.
//
// Two render modes, controlled by the `SidebarProvider` context:
//
//   • Expanded (default, ~16rem) - brand row + search + "+ New" CTA +
//     wallet list + recent activity feed + connected pill + settings.
//   • Collapsed (rail, ~4rem) - icon-only column. Recent feed hides;
//     connected pill collapses to the account indicator.
//
// On mobile the component is rendered inside HeaderBar's drawer; the
// drawer overrides the rail state via `forceExpanded` so users always
// see the full content when they open the menu.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet";
import {
  Activity as ActivityIcon,
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Contact as ContactIcon,
  Home,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  Wallet as WalletIcon,
  type LucideIcon,
} from "lucide-react";
import { requestCommandPaletteOpen } from "@/components/layout/commandPaletteBus";
import { BrandMark } from "@/components/retail/BrandMark";
import clsx from "clsx";
import {
  fetchOnchainMemberships,
  type OnchainMembership,
} from "@/lib/memberships/client";
import { useActionNeeded } from "@/lib/hooks/useActionNeeded";
import { toDisplayName } from "@/lib/retail/walletNames";
import {
  productWorkspaceHomeHref,
  productWorkspaceLabel,
  resolveWalletProductSurface,
  type WalletProductSurface,
} from "@/lib/productWorkspace";
import { PRODUCT_SURFACE_ICON } from "@/lib/productIcons";
import { useSidebar } from "@/components/providers/SidebarProvider";
import {
  activeWalletSlugFromPathname,
  isWalletNavActive,
  walletNavHref,
  walletSubNav,
} from "@/components/layout/walletScopedNav";

type Props = {
  /// Called after a navigation link fires - used by the mobile drawer
  /// to close itself.
  onNavigate?: () => void;
  /// When true, ignores the rail (collapsed) state and always renders
  /// expanded. Used when this component is rendered inside the mobile
  /// drawer, where the rail mode would defeat the drawer's purpose.
  forceExpanded?: boolean;
};

export function WorkspaceSidebar({ onNavigate, forceExpanded }: Props) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const pathname = usePathname() ?? "";
  const sidebar = useSidebar();
  const expanded = forceExpanded || (sidebar?.expanded ?? true);

  const myOrganizationsQuery = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  const memberships = myOrganizationsQuery.data ?? [];
  // Used by the Home tab badge in the primary nav. Cheap - derives
  // from queries already mounted higher up the tree.
  const action = useActionNeeded();
  const recent = action.activity;
  const pendingCount = action.rows.length;

  // Pull the active wallet slug out of the path so wallet-scoped
  // entries (Chains, …) can link straight back into the right
  // wallet. Matches /app/wallet/{name}/... and decodes the slug.
  // null when the user is on a non-wallet route (e.g. /app/settings,
  // /app/wallet hub) - the entry hides so we never render a broken
  // /app/wallet//chains link.
  const activeWalletSlug = activeWalletSlugFromPathname(pathname);

  return (
    <div
      className={clsx(
        "flex h-full flex-col text-sm text-text-strong",
        // Tighter padding in rail mode so icons sit center-aligned
        // without their hit-targets bleeding into the edge border.
        expanded ? "gap-5 p-4" : "gap-4 p-2",
      )}
    >
      <BrandRow
        expanded={expanded}
        canToggle={!forceExpanded}
        onToggle={sidebar?.toggleExpanded}
      />

      {/* Two layout paths in one sidebar:
       *   • Inside a wallet (`activeWalletSlug` set) - the sidebar
       *     becomes wallet-scoped: back link to the hub, active
       *     wallet identity card, and a focused sub-nav. Hides the
       *     global workspace chrome so the user feels they're
       *     "inside" the wallet.
       *   • Anywhere else - the standard workspace chrome (search +
       *     new + primary nav + wallets list). */}
      {activeWalletSlug ? (
        <WalletScopedSidebar
          slug={activeWalletSlug}
          pathname={pathname}
          expanded={expanded}
          onNavigate={onNavigate}
        />
      ) : (
        <>
          {/* Workspace actions - global Search trigger + New shared
              wallet CTA. Lives near the top so the user's first
              instinct ("I want to find or create something") is
              reachable in two pixels. */}
          <WorkspaceActions expanded={expanded} onNavigate={onNavigate} />

          {/* Primary navigation - the four cross-cutting
              destinations a user can reach without drilling into a
              specific wallet. */}
          <PrimaryNav
            pathname={pathname}
            expanded={expanded}
            pendingCount={pendingCount}
            onNavigate={onNavigate}
          />

          {/* Wallet list - the entry point into a wallet's own
              layout. Tapping a row swaps the sidebar to the wallet-
              scoped variant above. */}
          <SidebarSection
            label="Workspaces"
            count={memberships.length}
            loading={myOrganizationsQuery.isLoading}
            expanded={expanded}
          >
            {memberships.length === 0 && !myOrganizationsQuery.isLoading ? (
              expanded ? (
                <p className="px-2 text-[11px] text-text-soft">
                  {wallet.connected
                    ? "No wallets yet. Create one above."
                    : "Connect to see your wallets."}
                </p>
              ) : null
            ) : (
              <ul className="flex flex-col gap-0.5">
                {memberships.map((m) => (
                  <SidebarOrgLink
                    key={m.wallet}
                    membership={m}
                    pathname={pathname}
                    pendingCount={recent.pendingByWallet.get(m.wallet) ?? 0}
                    onNavigate={onNavigate}
                    expanded={expanded}
                  />
                ))}
              </ul>
            )}
          </SidebarSection>

        </>
      )}

      <div
        className={clsx(
          "mt-auto flex flex-col border-t border-border-soft",
          expanded ? "gap-1 pt-4" : "items-center gap-2 pt-3",
        )}
      >
        {/* Connect / Disconnect moved to the desktop top header so
            it sits at eye level instead of buried in the sidebar
            footer. The bottom group is intentionally spare. */}
      </div>
    </div>
  );
}

// ─── Primary nav ───────────────────────────────────────────────────
//
// The four cross-cutting destinations: Home (wallet hub + drill-downs),
// Activity, Contacts, Settings. Renders as a labeled list in expanded
// mode, icon-only in rail mode (active state via accent fill, pending
// count surfaces as a corner dot). Mirrors the active-prefix logic
// BottomNav and the previous DashboardHeader used so navigation feels
// the same regardless of viewport.

type PrimaryNavItem = {
  id?: "home";
  href: string;
  label: string;
  Icon: LucideIcon;
  matchPrefixes?: string[];
};

const PRIMARY_NAV: PrimaryNavItem[] = [
  {
    id: "home",
    href: "/app/wallet",
    label: "Home",
    Icon: Home,
    // /app/wallet exact-match handles the hub itself.
    // /app/wallet/{name}/... is intentionally NOT in the prefix
    // list - when the user opens a specific wallet, the Home tab
    // should drop out of active state so only the wallet row in
    // the sidebar lights up. Cross-wallet inboxes (proposals /
    // intents / invitations) DO stay under Home.
    matchPrefixes: [
      "/app/proposals",
      "/app/intents",
      "/app/invitations",
    ],
  },
  { href: "/app/activity", label: "Activity", Icon: ActivityIcon },
  { href: "/app/contacts", label: "Contacts", Icon: ContactIcon },
  {
    href: "/app/account",
    label: "Account",
    Icon: UserCircle2,
    matchPrefixes: ["/app/account"],
  },
  {
    href: "/app/settings",
    label: "Settings",
    Icon: Settings,
    matchPrefixes: ["/app/settings"],
  },
];

function isPrimaryActive(pathname: string, item: PrimaryNavItem): boolean {
  if (pathname === item.href) return true;
  for (const p of item.matchPrefixes ?? []) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true;
  }
  return false;
}

function PrimaryNav({
  pathname,
  expanded,
  pendingCount,
  onNavigate,
}: {
  pathname: string;
  expanded: boolean;
  pendingCount: number;
  onNavigate?: () => void;
}) {
  return (
    <nav
      aria-label="Primary"
      className={clsx(
        "flex flex-col",
        expanded ? "gap-0.5" : "items-center gap-1.5",
      )}
    >
      {PRIMARY_NAV.map((item) => {
        const active = isPrimaryActive(pathname, item);
        const showBadge = item.id === "home" && pendingCount > 0;
        const badgeLabel = pendingCount > 9 ? "9+" : String(pendingCount);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            aria-label={item.label}
            title={!expanded ? item.label : undefined}
            className={clsx(
              "group relative inline-flex items-center text-xs font-medium",
              "transition-colors duration-base ease-out-soft",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              expanded
                ? "gap-3 rounded-xl px-3 py-2"
                : "h-10 w-10 justify-center rounded-soft",
              active
                ? "bg-accent/10 text-accent"
                : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
            )}
          >
            <item.Icon size={14} className="shrink-0" aria-hidden="true" />
            {expanded && <span className="flex-1 truncate">{item.label}</span>}
            {showBadge && expanded && (
              <span
                aria-label={`${pendingCount} pending`}
                className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent/15 px-1 text-[10px] font-semibold leading-none text-accent"
              >
                {badgeLabel}
              </span>
            )}
            {showBadge && !expanded && (
              <span
                aria-hidden="true"
                className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-canvas"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}

// ─── Workspace actions ────────────────────────────────────────────
//
// Global Search trigger (opens the ⌘K command palette) + New shared
// wallet CTA. Sits between the BrandRow and the PrimaryNav so the
// user's first two clicks ("find" or "create") are always one step
// away regardless of which page they're on.

function WorkspaceActions({
  expanded,
  onNavigate,
}: {
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const handleSearch = () => {
    requestCommandPaletteOpen();
  };

  if (!expanded) {
    // Rail mode - icon-only column, same hit-target spec as PrimaryNav.
    return (
      <div className="flex flex-col items-center gap-1.5">
        <button
          type="button"
          onClick={handleSearch}
          aria-label="Search"
          title="Search (⌘K)"
          className={clsx(
            "flex h-10 w-10 items-center justify-center rounded-soft border border-border-soft text-text-soft",
            "transition-colors duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          <Search size={14} aria-hidden="true" />
        </button>
        <Link
          href="/app/wallet/new"
          onClick={onNavigate}
          aria-label="New wallet"
          title="New wallet"
          className={clsx(
            "flex h-10 w-10 items-center justify-center rounded-soft bg-accent text-text-on-accent shadow-accent-rest",
            "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
            "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          <Plus size={14} aria-hidden="true" />
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleSearch}
        aria-label="Search (⌘K)"
        className={clsx(
          "group inline-flex items-center gap-2 rounded-soft border border-border-soft bg-glass-soft px-3 py-2 text-xs text-text-soft",
          "transition-colors duration-base ease-out-soft hover:border-border-strong hover:bg-glass-mid hover:text-text-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        )}
      >
        <Search size={13} aria-hidden="true" />
        <span className="flex-1 text-left">Search</span>
        <kbd className="rounded border border-border-soft bg-glass-soft px-1.5 py-0.5 font-mono text-[10px] text-text-soft">
          ⌘K
        </kbd>
      </button>
      <Link
        href="/app/wallet/new"
        onClick={onNavigate}
        aria-label="New wallet"
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest",
          "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
          "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        )}
      >
        <Plus size={13} aria-hidden="true" />
        New wallet
      </Link>
    </div>
  );
}

// ─── Wallet-scoped sidebar ────────────────────────────────────────
//
// The chrome a user sees once they've drilled into /app/wallet/{name}.
// Replaces the global workspace nav (Search / Primary / Wallets list)
// with a focused wallet layout: back link, active wallet identity,
// and a sub-nav for the wallet's own destinations.
//
// Sub-nav entries map directly to the routes under /app/wallet/[name]/
// so each link has a real target. Active state matches by
// pathname.startsWith(href) so deep drill-downs (e.g. /send/eth,
// /policy#approvals) still highlight the correct top-level entry. The
// Overview entry is exact-match only - any sub-route should claim
// its own tab, not Overview.

function WalletScopedSidebar({
  slug,
  pathname,
  expanded,
  onNavigate,
}: {
  slug: string;
  pathname: string;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const display = toDisplayName(slug);
  const base = `/app/wallet/${encodeURIComponent(slug)}`;
  const surface = resolveWalletProductSurface(slug);
  const ProductIcon = surface ? PRODUCT_SURFACE_ICON[surface] : WalletIcon;
  const navItems = walletSubNav(surface);

  const isActive = (sub: string) => isWalletNavActive(pathname, base, sub);

  // ── Rail mode (collapsed sidebar) ──────────────────────────────
  if (!expanded) {
    return (
      <div className="flex flex-col items-center gap-1.5">
        <Link
          href="/app/wallet"
          onClick={onNavigate}
          aria-label="All wallets"
          title="All wallets"
          className={clsx(
            "flex h-10 w-10 items-center justify-center rounded-soft border border-border-soft text-text-soft",
            "transition-colors duration-base ease-out-soft hover:border-border-strong hover:text-text-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          <ArrowLeft size={14} aria-hidden="true" />
        </Link>
        <span
          aria-label={display}
          title={display}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent"
        >
          <ProductIcon size={15} aria-hidden="true" />
        </span>
        {navItems.map(({ sub, label, Icon }) => {
          const href = walletNavHref(base, sub);
          const active = isActive(sub);
          return (
            <Link
              key={sub || "overview"}
              href={href}
              onClick={onNavigate}
              aria-label={label}
              title={label}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "flex h-10 w-10 items-center justify-center rounded-soft transition-colors duration-base ease-out-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
              )}
            >
              <Icon size={14} aria-hidden="true" />
            </Link>
          );
        })}
      </div>
    );
  }

  // ── Expanded mode ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4">
      {/* Back to all wallets - small monospace caps link, sits at
          the top so the user always knows they're inside a scoped
          surface and how to escape. */}
      <Link
        href="/app/wallet"
        onClick={onNavigate}
        className={clsx(
          "inline-flex items-center gap-1.5 self-start rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft",
          "transition-colors duration-base ease-out-soft hover:text-text-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        )}
      >
        <ArrowLeft size={11} aria-hidden="true" />
        All wallets
      </Link>

      {/* Active wallet identity card - display name +
          monospace eyebrow. Anchors the user's mental model of
          "you're inside this wallet." */}
      <div className="rounded-xl border border-border-soft bg-glass-soft p-3">
        <div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ProductIcon size={15} aria-hidden="true" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-soft">
            {productWorkspaceLabel(surface)}
          </span>
          <span className="mt-0.5 truncate font-display text-[13px] font-semibold tracking-[-0.01em] text-text-strong">
            {display}
          </span>
        </div>
      </div>

      {/* Sub-nav - the wallet's own destinations. */}
      <nav
        aria-label="Wallet"
        className="flex flex-col gap-0.5"
      >
        <p className="mb-1 px-3 font-mono text-[10px] uppercase tracking-[0.22em] text-text-soft">
          Manage
        </p>
        {navItems.map(({ sub, label, Icon }) => {
          const href = walletNavHref(base, sub);
          const active = isActive(sub);
          return (
            <Link
              key={sub || "overview"}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={clsx(
                "group inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium",
                "transition-colors duration-base ease-out-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
              )}
            >
              <Icon size={14} className="shrink-0" aria-hidden="true" />
              <span className="flex-1 truncate">{label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function BrandRow({
  expanded,
  canToggle,
  onToggle,
}: {
  expanded: boolean;
  canToggle: boolean;
  onToggle?: () => void;
}) {
  return (
    <div
      className={clsx(
        "flex items-center",
        expanded ? "justify-between" : "flex-col gap-2",
      )}
    >
      <Link
        href="/app/wallet"
        aria-label="Clear home"
        className={clsx(
          "flex items-center rounded-xl transition-opacity duration-base ease-out-soft hover:opacity-80",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          expanded ? "gap-2 px-1 py-1" : "p-1",
        )}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl">
          <BrandMark size={18} />
        </div>
        {expanded && (
          <span className="font-display text-base font-semibold tracking-tight text-text-strong">
            Clear
          </span>
        )}
      </Link>
      {canToggle && onToggle && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
          title={expanded ? "Collapse sidebar" : "Expand sidebar"}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-soft text-text-soft",
            "transition-colors duration-base ease-out-soft hover:bg-glass-mid hover:text-text-strong",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          {expanded ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
        </button>
      )}
    </div>
  );
}

function SidebarSection({
  label,
  count,
  loading,
  expanded,
  children,
}: {
  label: string;
  count?: number;
  loading?: boolean;
  expanded: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      {expanded && (
        <div className="flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            {label}
          </span>
          {!loading && typeof count === "number" && count > 0 && (
            <span className="rounded-full border border-border-soft bg-glass-soft px-2 py-0.5 font-mono text-[10px] text-text-soft">
              {count}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

// Compact "Secure" entry - icon + single label, matching the
// PrimaryNav row style. Clicking it navigates to /app/secure where
// the recovery flow begins. Pure UI swap from the previous promo
// card; routing target is unchanged.
function SecurePromoCard({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate?: () => void;
}) {
  const href = "/app/secure";
  const active = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      aria-label="Secure"
      className={clsx(
        "group relative inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium",
        "transition-colors duration-base ease-out-soft",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        active
          ? "bg-accent/10 text-accent"
          : "text-text-soft hover:bg-glass-mid hover:text-text-strong",
      )}
    >
      <ShieldCheck size={14} className="shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">Secure</span>
    </Link>
  );
}

function SidebarOrgLink({
  membership,
  pathname,
  pendingCount,
  onNavigate,
  expanded,
}: {
  membership: OnchainMembership;
  pathname: string;
  pendingCount: number;
  onNavigate?: () => void;
  expanded: boolean;
}) {
  const onChainName = membership.wallet_name ?? "";
  const surface = resolveWalletProductSurface(onChainName);
  const href = onChainName ? productWorkspaceHomeHref(onChainName, surface) : "#";
  const ProductIcon = surface ? PRODUCT_SURFACE_ICON[surface] : WalletIcon;
  const walletBase = onChainName
    ? `/app/wallet/${encodeURIComponent(onChainName)}`
    : "";
  const active = !!onChainName && pathname.startsWith(walletBase);

  if (!onChainName) return null;

  const display = toDisplayName(onChainName);
  // Rail mode - icon-only, full hit target on the wallet tile, name +
  // pending count surface via title attribute.
  if (!expanded) {
    const title =
      pendingCount > 0
        ? `${display} · ${pendingCount} pending`
        : display;
    return (
      <li className="relative">
        <Link
          href={href}
          onClick={onNavigate}
          aria-label={title}
          title={title}
          className={clsx(
            "relative flex h-10 w-10 items-center justify-center rounded-xl",
            "transition-transform duration-base ease-out-soft hover:scale-105 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          )}
        >
          <ProductIcon
            size={16}
            className={active ? "text-accent" : "text-text-soft"}
            aria-hidden="true"
          />
          {pendingCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-surface-raised" />
            </span>
          )}
        </Link>
      </li>
    );
  }

  return (
    <li className="relative">
      {/* Active-state accent bar - Linear/Notion's move. Sits flush
          with the row edge and reads "this is your context" without
          relying on color contrast alone. */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-0.5 rounded-full bg-accent"
        />
      )}
      <Link
        href={href}
        onClick={onNavigate}
        className={clsx(
          "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium transition-colors duration-base ease-out-soft",
          active
            ? "bg-accent/10 text-accent"
            : "text-text-strong hover:bg-canvas",
        )}
      >
        <ProductIcon
          size={14}
          className={clsx("shrink-0", active ? "text-accent" : "text-text-soft")}
          aria-hidden="true"
        />
        <span className="truncate">{display}</span>
        {pendingCount > 0 && (
          <span
            aria-label={`${pendingCount} need${pendingCount === 1 ? "s" : ""} approval`}
            className="ml-auto inline-flex items-center rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent"
          >
            {pendingCount}
          </span>
        )}
      </Link>
    </li>
  );
}
