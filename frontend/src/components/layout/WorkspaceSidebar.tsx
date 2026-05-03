"use client";

// Workspace sidebar — retail rebuild (locked 2026-04-30).
//
// Persistent left rail on desktop (md+), drawer body on mobile. Drops
// "treasury console" framing, role badges, raw addresses, and proposal
// index numbers — keeps the same data, reframed in retail vocabulary:
//
//   - Brand: "Clear" (no -msig suffix per the locked spec).
//   - "Your wallets" instead of "My organizations".
//   - "+ New shared wallet" routes to /welcome (the retail story flow).
//   - Wallet rows: name + pulse-badge for pending approvals only.
//   - "Recent" feed: friendly status text, no #N proposal indices.
//   - Bottom: settings-style row, no jargon footer.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@/lib/wallet";
import { Github, LogOut, Plus, Search, Settings } from "lucide-react";
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

type Props = {
  /// Called after a navigation link fires — used by the mobile drawer
  /// to close itself.
  onNavigate?: () => void;
};

export function WorkspaceSidebar({ onNavigate }: Props) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const pathname = usePathname() ?? "";

  const myOrganizationsQuery = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  const memberships = myOrganizationsQuery.data ?? [];
  // Sidebar Recent shows the 3 most recent rows. Tighter than the
  // dashboard's 5-row feed because the sidebar is navigation, not
  // read-the-feed. The dashboard's RecentActivitySection is where you
  // actually browse activity.
  const recent = useRecentActivity(3);

  return (
    <div className="flex h-full flex-col gap-5 p-5 text-sm text-white">
      <BrandRow />

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openCommandPalette();
        }}
        className={
          "group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-white/60 " +
          "transition-colors duration-base ease-out-soft hover:border-white/20 hover:bg-white/10 hover:text-white " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card-strong"
        }
      >
        <Search size={14} className="text-white/40 group-hover:text-white" />
        <span>Search</span>
        <kbd className="ml-auto rounded border border-white/10 bg-surface-card-strong/40 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
          ⌘K
        </kbd>
      </button>

      {/* Primary CTA — same shape and shadow as the retail Button
          primitive (rounded-soft + accent shadow), just sized for the
          sidebar's tighter density. */}
      <Link
        href="/welcome"
        onClick={onNavigate}
        className={
          "group inline-flex items-center justify-center gap-2 rounded-soft bg-accent px-4 py-2.5 text-xs font-medium text-white " +
          "shadow-accent-rest transition-[background-color,box-shadow,transform] duration-base ease-out-soft " +
          "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98] " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card-strong"
        }
      >
        <Plus size={14} />
        New shared wallet
      </Link>

      {/* Wallet list is hidden on the dashboard (/app/wallet) where
          the page already renders the same wallets as cards with
          richer info (balance, avatar, member count). On every other
          /app/* route, the user's drilled into one wallet and needs
          the cross-wallet list back in the sidebar to jump between
          them. */}
      {pathname !== "/app/wallet" && (
        <SidebarSection
          label="Your wallets"
          count={memberships.length}
          loading={myOrganizationsQuery.isLoading}
        >
          {memberships.length === 0 && !myOrganizationsQuery.isLoading ? (
            <p className="px-2 text-[11px] text-white/40">
              {wallet.connected
                ? "No wallets yet. Create one above."
                : "Connect to see your wallets."}
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {memberships.map((m) => (
                <SidebarOrgLink
                  key={m.wallet}
                  membership={m}
                  pathname={pathname}
                  pendingCount={recent.pendingByWallet.get(m.wallet) ?? 0}
                  onNavigate={onNavigate}
                />
              ))}
            </ul>
          )}
        </SidebarSection>
      )}

      <SidebarSection
        label="Recent"
        count={recent.rows.length}
        loading={recent.loading}
      >
        {recent.rows.length === 0 && !recent.loading ? (
          <p className="px-2 text-[11px] text-white/40">
            Nothing here yet.
          </p>
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

      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-4">
        {wallet.connected && address && (
          <ConnectedAsPill
            address={address}
            onDisconnect={() => {
              wallet.disconnect();
              onNavigate?.();
            }}
          />
        )}
        <Link
          href="/app/settings"
          onClick={onNavigate}
          className={clsx(
            "inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium transition-colors duration-base ease-out-soft",
            pathname.startsWith("/app/settings")
              ? "bg-accent/15 text-accent"
              : "text-white/60 hover:bg-white/5 hover:text-white",
          )}
        >
          <Settings
            size={14}
            className={
              pathname.startsWith("/app/settings")
                ? "text-accent"
                : "text-white/40"
            }
          />
          Settings
        </Link>
        <a
          href="https://github.com/clear-msig/clear-msig"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-medium text-white/60 transition-colors duration-base ease-out-soft hover:bg-white/5 hover:text-white"
        >
          <Github size={14} className="text-white/40" />
          GitHub
        </a>
      </div>
    </div>
  );
}

function ConnectedAsPill({
  address,
  onDisconnect,
}: {
  address: string;
  onDisconnect: () => void;
}) {
  // Shortened address — first 4 + last 4 of base58, the convention
  // every Solana wallet UI uses. Hover reveals the disconnect action
  // so the bottom of the sidebar isn't dominated by a destructive
  // verb the user almost never wants to click.
  const grad = avatarGradient(address);
  const short = `${address.slice(0, 4)}…${address.slice(-4)}`;
  return (
    <div className="group/pill relative">
      <div
        className={
          "flex items-center gap-2.5 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2 text-xs " +
          "transition-colors duration-base ease-out-soft group-hover/pill:border-white/20 group-hover/pill:bg-white/[0.06]"
        }
      >
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
          <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
            Connected
          </span>
          <span className="truncate font-mono text-[11px] text-white/80">
            {short}
          </span>
        </span>
        <button
          type="button"
          onClick={onDisconnect}
          aria-label="Disconnect wallet"
          className={
            "rounded-md p-1 text-white/40 transition-colors duration-base ease-out-soft " +
            "hover:bg-rose-500/15 hover:text-rose-300 " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card-strong"
          }
        >
          <LogOut size={13} />
        </button>
      </div>
    </div>
  );
}

function BrandRow() {
  return (
    <Link
      href="/app/wallet"
      className="flex items-center gap-2 rounded-xl px-1 py-1 transition-opacity duration-base ease-out-soft hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card-strong"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent/15 text-accent">
        <BrandMark size={20} />
      </div>
      <span className="font-display text-base font-semibold tracking-tight text-white">
        Clear
      </span>
    </Link>
  );
}

function SidebarSection({
  label,
  count,
  loading,
  children,
}: {
  label: string;
  count?: number;
  loading?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between px-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">
          {label}
        </span>
        {!loading && typeof count === "number" && count > 0 && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/50">
            {count}
          </span>
        )}
      </div>
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
            ? "bg-accent/15 text-accent"
            : "text-white/60 hover:bg-white/5 hover:text-white",
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-medium">{toDisplayName(row.walletName)}</span>
          <span className="flex items-center gap-1.5 text-[10px] text-white/40">
            <span>{friendlyStatus(row.status, row.intentTemplate)}</span>
            {row.proposedAt > 0n && (
              <>
                <span className="text-white/20">·</span>
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
}: {
  membership: OnchainMembership;
  pathname: string;
  pendingCount: number;
  onNavigate?: () => void;
}) {
  const onChainName = membership.wallet_name ?? "";
  const href = onChainName ? `/app/wallet/${encodeURIComponent(onChainName)}` : "#";
  const active = onChainName && pathname.startsWith(href);

  // Without a name (rare — wallet missing from the on-chain account)
  // we skip rendering rather than show a raw address.
  if (!onChainName) return null;

  // Display strips the per-creator suffix; URLs and PDA lookups
  // keep the on-chain form so chain reads still resolve.
  const display = toDisplayName(onChainName);
  // Per-wallet identity: gradient avatar with the wallet name's
  // first letter. Hash the on-chain name (suffixed) so two creators
  // who both call their wallet "Family" still get visually distinct
  // gradients.
  const grad = gradientFor(onChainName, avatarGradient(onChainName));
  const initial = display.trim().charAt(0).toUpperCase() || "?";

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
            ? "bg-accent/15 text-accent"
            : "text-white/75 hover:bg-white/5 hover:text-white",
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
