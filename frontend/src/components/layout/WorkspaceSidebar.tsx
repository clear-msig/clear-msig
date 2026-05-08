"use client";

// Workspace sidebar — light-theme rail with expand-to-full toggle.
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
//   • Expanded (default, ~16rem) — brand row + search + "+ New" CTA +
//     wallet list + recent activity feed + connected pill + settings.
//   • Collapsed (rail, ~4rem) — icon-only column. Wallet list shows
//     gradient avatars; recent feed hides; pill collapses to avatar.
//
// On mobile the component is rendered inside HeaderBar's drawer; the
// drawer overrides the rail state via `forceExpanded` so users always
// see the full content when they open the menu.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet";
import {
  ChevronsLeft,
  ChevronsRight,
  Layers,
  LogOut,
  Plus,
  Search,
  Settings,
} from "lucide-react";
import { BrandMark } from "@/components/retail/BrandMark";
import clsx from "clsx";
import {
  fetchOnchainMemberships,
  type OnchainMembership,
} from "@/lib/memberships/client";
import { openCommandPalette } from "@/components/layout/CommandPalette";
import {
  useRecentActivity,
  type RecentActivityRow,
} from "@/lib/hooks/useRecentActivity";
import { friendlyStatus } from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";
import { relativeTime } from "@/lib/util/relativeTime";
import { avatarGradient } from "@/lib/retail/avatar";
import { gradientFor } from "@/lib/retail/walletAppearance";
import { useSidebar } from "@/components/providers/SidebarProvider";

type Props = {
  /// Called after a navigation link fires — used by the mobile drawer
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
  const recent = useRecentActivity(3);

  // Pull the active wallet slug out of the path so wallet-scoped
  // entries (Chains, …) can link straight back into the right
  // wallet. Matches /app/wallet/{name}/... and decodes the slug.
  // null when the user is on a non-wallet route (e.g. /app/settings,
  // /app/wallet hub) — the entry hides so we never render a broken
  // /app/wallet//chains link.
  const activeWalletSlug = (() => {
    const m = pathname.match(/^\/app\/wallet\/([^/]+)/);
    if (!m || !m[1]) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  })();

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

      {/* Search — opens the cmd-K palette. Touch-only trigger; the
          keyboard shortcut works globally regardless. */}
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openCommandPalette();
        }}
        aria-label="Search"
        className={clsx(
          "group flex items-center rounded-soft border border-border-soft bg-canvas/50 text-left text-text-soft",
          "transition-colors duration-base ease-out-soft hover:border-border-strong hover:bg-canvas hover:text-text-strong",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          expanded ? "gap-2 px-3 py-2 text-xs" : "h-10 w-10 justify-center self-center",
        )}
      >
        <Search size={14} className="shrink-0" />
        {expanded && (
          <>
            <span>Search</span>
            <kbd className="ml-auto rounded border border-border-soft bg-canvas px-1.5 py-0.5 font-mono text-[10px] text-text-soft">
              ⌘K
            </kbd>
          </>
        )}
      </button>

      {/* Primary CTA — "+ New shared wallet". Same accent green as the
          rest of the app's primary actions. */}
      <Link
        href="/welcome"
        onClick={onNavigate}
        aria-label="New shared wallet"
        className={clsx(
          "group inline-flex items-center justify-center gap-2 rounded-soft bg-accent text-xs font-medium text-white",
          "shadow-accent-rest transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
          "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          expanded ? "px-4 py-2.5" : "h-10 w-10 self-center p-0",
        )}
      >
        <Plus size={14} className="shrink-0" />
        {expanded && <span>New shared wallet</span>}
      </Link>

      {/* Wallet list. Hidden on the dashboard (/app/wallet) where the
          page already renders the same wallets as cards with richer
          info. On every other /app/* route the user has drilled into
          one wallet and needs cross-wallet navigation back in the
          sidebar. */}
      {pathname !== "/app/wallet" && (
        <SidebarSection
          label="Your wallets"
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
      )}

      {/* Recent activity. Hidden in rail mode — text-only rows don't
          translate to a meaningful icon and stacking would just create
          dead space. */}
      {expanded && (
        <SidebarSection
          label="Recent"
          count={recent.rows.length}
          loading={recent.loading}
          expanded={expanded}
        >
          {recent.rows.length === 0 && !recent.loading ? (
            <p className="px-2 text-[11px] text-text-soft">Nothing here yet.</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {recent.rows.map((r) => (
                <SidebarActivityRow
                  key={r.proposalPda}
                  row={r}
                  pathname={pathname}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
        </SidebarSection>
      )}

      <div
        className={clsx(
          "mt-auto flex flex-col border-t border-border-soft",
          expanded ? "gap-1 pt-4" : "items-center gap-2 pt-3",
        )}
      >
        {wallet.connected && address && (
          <ConnectedAsPill
            address={address}
            expanded={expanded}
            onDisconnect={() => {
              wallet.disconnect();
              onNavigate?.();
            }}
          />
        )}
        {/* Chains — wallet-scoped entry. Only renders when the
            user is inside a /app/wallet/{name}/... route so the
            link has a real target. Was the most-flagged "I can't
            find where to add a chain" surface; lives here next to
            Settings so it sits in the menu icon row on rail mode
            too (icon-only sidebar) — discoverable from anywhere
            inside a wallet without drilling through the Manage
            tab. */}
        {activeWalletSlug && (
          <Link
            href={`/app/wallet/${encodeURIComponent(activeWalletSlug)}/chains`}
            onClick={onNavigate}
            aria-label="Chains for this wallet"
            title="Chains for this wallet"
            className={clsx(
              "inline-flex items-center text-xs font-medium transition-colors duration-base ease-out-soft",
              expanded ? "gap-3 rounded-xl px-3 py-2" : "h-10 w-10 justify-center rounded-soft",
              pathname.includes("/chains")
                ? "bg-accent/10 text-accent"
                : "text-text-soft hover:bg-canvas hover:text-text-strong",
            )}
          >
            <Layers size={14} className="shrink-0" />
            {expanded && <span>Chains</span>}
          </Link>
        )}
        <Link
          href="/app/settings"
          onClick={onNavigate}
          aria-label="Settings"
          className={clsx(
            "inline-flex items-center text-xs font-medium transition-colors duration-base ease-out-soft",
            expanded ? "gap-3 rounded-xl px-3 py-2" : "h-10 w-10 justify-center rounded-soft",
            pathname.startsWith("/app/settings")
              ? "bg-accent/10 text-accent"
              : "text-text-soft hover:bg-canvas hover:text-text-strong",
          )}
        >
          <Settings size={14} className="shrink-0" />
          {expanded && <span>Settings</span>}
        </Link>
      </div>
    </div>
  );
}

function ConnectedAsPill({
  address,
  expanded,
  onDisconnect,
}: {
  address: string;
  expanded: boolean;
  onDisconnect: () => void;
}) {
  const grad = avatarGradient(address);
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;

  // Rail mode: just the avatar dot + a small disconnect hover state.
  if (!expanded) {
    return (
      <button
        type="button"
        onClick={onDisconnect}
        aria-label={`Disconnect ${short}`}
        title={`${short} · click to disconnect`}
        className={clsx(
          "flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br shadow-sm",
          "transition-transform duration-base ease-out-soft hover:scale-105 active:scale-95",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          grad.from,
          grad.to,
        )}
      >
        <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
      </button>
    );
  }

  return (
    <div className="group/pill relative">
      <div className="flex items-center gap-2.5 rounded-xl border border-border-soft bg-canvas/50 px-2.5 py-2 text-xs transition-colors duration-base ease-out-soft group-hover/pill:bg-canvas">
        <span
          className={clsx(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-[10px] font-semibold text-white shadow-sm",
            grad.from,
            grad.to,
          )}
          aria-hidden="true"
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-white/90" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Connected
          </span>
          <span className="truncate font-mono text-[11px] text-text-strong">
            {short}
          </span>
        </span>
        <button
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
          className="rounded-md p-1 text-text-soft transition-colors duration-base ease-out-soft hover:bg-danger/10 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
        >
          <LogOut size={13} />
        </button>
      </div>
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
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <BrandMark size={20} />
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
            "transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-text-strong",
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
            <span className="rounded-full bg-canvas px-2 py-0.5 text-[10px] text-text-soft">
              {count}
            </span>
          )}
        </div>
      )}
      {children}
    </section>
  );
}

function SidebarActivityRow({
  row,
  pathname,
  onNavigate,
}: {
  row: RecentActivityRow;
  pathname: string;
  onNavigate?: () => void;
}) {
  const href = `/app/proposals/${encodeURIComponent(row.proposalPda)}`;
  const active = pathname === href;

  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className={clsx(
          "group flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] transition-colors duration-base ease-out-soft",
          active
            ? "bg-accent/10 text-accent"
            : "text-text-soft hover:bg-canvas hover:text-text-strong",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">
            {toDisplayName(row.walletName)}
          </span>
          <span className="flex items-center gap-1.5 text-[10px] text-text-soft">
            <span>{friendlyStatus(row.status, row.intentTemplate)}</span>
            {row.proposedAt > 0n && (
              <>
                <span aria-hidden="true" className="text-text-soft">·</span>
                <span>{relativeTime(row.proposedAt)}</span>
              </>
            )}
          </span>
        </span>
      </Link>
    </li>
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
  const href = onChainName ? `/app/wallet/${encodeURIComponent(onChainName)}` : "#";
  const active = onChainName && pathname.startsWith(href);

  if (!onChainName) return null;

  const display = toDisplayName(onChainName);
  const grad = gradientFor(onChainName, avatarGradient(onChainName));
  const initial = display.trim().charAt(0).toUpperCase() || "?";

  // Rail mode — icon-only, full hit target on the avatar tile, name +
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
            "relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-[11px] font-semibold text-white shadow-sm",
            "transition-transform duration-base ease-out-soft hover:scale-105 active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
            grad.from,
            grad.to,
            active && "ring-2 ring-accent ring-offset-2 ring-offset-surface-raised",
          )}
        >
          {initial}
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
      {/* Active-state accent bar — Linear/Notion's move. Sits flush
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
        <span
          className={clsx(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br text-[10px] font-semibold text-white shadow-sm",
            grad.from,
            grad.to,
          )}
          aria-hidden="true"
        >
          {initial}
        </span>
        <span className="truncate">{display}</span>
        {pendingCount > 0 && (
          <span
            aria-label={`${pendingCount} need${pendingCount === 1 ? "s" : ""} approval`}
            className="ml-auto inline-flex items-center gap-1 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent"
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
            </span>
            {pendingCount}
          </span>
        )}
      </Link>
    </li>
  );
}
