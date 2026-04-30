"use client";

// Workspace sidebar — persistent left rail on desktop, drawer body on
// mobile. Lists the connected wallet's organisations and offers the
// "create wallet" CTA at the top so the user always has somewhere to go.
//
// Treated as a plain content component: presentation (persistent column
// vs slide-over drawer) is owned by the parent.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  Github,
  LogOut,
  Plus,
  RefreshCcw,
  Search,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import clsx from "clsx";
import {
  fetchOnchainMemberships,
  type OnchainMembership,
} from "@/lib/memberships/client";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { openCommandPalette } from "@/components/layout/CommandPalette";

type Props = {
  /// Called after a navigation link fires — used by the mobile drawer
  /// to close itself.
  onNavigate?: () => void;
};

export function WorkspaceSidebar({ onNavigate }: Props) {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const pathname = usePathname() ?? "";
  const { reset } = useOnboarding();

  const myOrganizationsQuery = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  const memberships = myOrganizationsQuery.data ?? [];

  return (
    <div className="flex h-full flex-col gap-5 p-5 text-sm text-white">
      <BrandRow />

      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          openCommandPalette();
        }}
        className="group flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-left text-xs text-white/60 transition-colors hover:border-white/20 hover:bg-white/10 hover:text-white"
      >
        <Search size={14} className="text-white/40 group-hover:text-white" />
        <span>Search wallets…</span>
        <kbd className="ml-auto rounded border border-white/10 bg-black/40 px-1.5 py-0.5 font-mono text-[10px] text-white/50">
          ⌘K
        </kbd>
      </button>

      <Link
        href="/app/wallet"
        onClick={onNavigate}
        className="group inline-flex items-center justify-center gap-2 rounded-2xl bg-brand-green px-4 py-2.5 text-xs font-bold text-black shadow-glow transition-all hover:bg-emerald-300"
      >
        <Plus size={14} />
        Create wallet
      </Link>

      <SidebarSection
        label="My wallets"
        count={memberships.length}
        loading={myOrganizationsQuery.isLoading}
      >
        {memberships.length === 0 && !myOrganizationsQuery.isLoading ? (
          <p className="px-2 text-[11px] text-white/40">
            {wallet.connected
              ? "No memberships yet. Create one above."
              : "Connect a wallet to see your organisations."}
          </p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {memberships.map((m) => (
              <SidebarOrgLink
                key={m.wallet}
                membership={m}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </ul>
        )}
      </SidebarSection>

      <div className="mt-auto flex flex-col gap-1 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={() => {
            reset();
            onNavigate?.();
          }}
          className="inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          <RefreshCcw size={14} className="text-white/40" />
          Show intro again
        </button>
        <a
          href="https://github.com/clear-msig/clear-msig"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-white/60 transition-colors hover:bg-white/5 hover:text-white"
        >
          <Github size={14} className="text-white/40" />
          GitHub
        </a>
        {wallet.connected && (
          <button
            type="button"
            onClick={() => {
              wallet.disconnect();
              onNavigate?.();
            }}
            className="inline-flex items-center gap-3 rounded-xl px-3 py-2 text-xs font-semibold text-rose-300 transition-colors hover:bg-rose-500/10"
          >
            <LogOut size={14} />
            Disconnect
          </button>
        )}
        <p className="mt-2 px-3 text-[10px] uppercase tracking-widest text-white/30">
          Pre-alpha · Devnet
        </p>
      </div>
    </div>
  );
}

function BrandRow() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-brand-green/15 text-brand-green">
        <ShieldCheck size={16} />
      </div>
      <div className="flex flex-col leading-tight">
        <span className="font-display text-sm font-bold tracking-tight text-white">
          Clear-MSIG
        </span>
        <span className="text-[9px] uppercase tracking-widest text-white/40">
          treasury console
        </span>
      </div>
    </div>
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
        <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">
          {label}
        </span>
        {!loading && typeof count === "number" && (
          <span className="rounded-full bg-white/5 px-2 py-0.5 font-mono text-[10px] text-white/50">
            {count}
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function SidebarOrgLink({
  membership,
  pathname,
  onNavigate,
}: {
  membership: OnchainMembership;
  pathname: string;
  onNavigate?: () => void;
}) {
  const name = membership.wallet_name ?? "";
  const href = name ? `/app/wallet/${encodeURIComponent(name)}` : "#";
  const active = name && pathname.startsWith(href);
  const isApprover = membership.roles.includes("approver");

  if (!name) {
    return (
      <li className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs text-white/40 opacity-70">
        <Wallet size={14} className="text-white/30" />
        <span className="truncate font-mono">
          {membership.wallet.slice(0, 6)}…{membership.wallet.slice(-4)}
        </span>
      </li>
    );
  }

  return (
    <li>
      <Link
        href={href}
        onClick={onNavigate}
        className={clsx(
          "group flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
          active
            ? "bg-brand-green/15 text-brand-green"
            : "text-white/70 hover:bg-white/5 hover:text-white"
        )}
      >
        <Wallet
          size={14}
          className={active ? "text-brand-green" : "text-white/40 group-hover:text-white"}
        />
        <span className="truncate">{name}</span>
        {isApprover && (
          <ShieldCheck
            size={10}
            className={clsx(
              "ml-auto shrink-0",
              active ? "text-brand-green" : "text-white/30"
            )}
          />
        )}
        {!isApprover && membership.roles.includes("proposer") && (
          <Users
            size={10}
            className={clsx(
              "ml-auto shrink-0",
              active ? "text-brand-green" : "text-white/30"
            )}
          />
        )}
      </Link>
    </li>
  );
}
