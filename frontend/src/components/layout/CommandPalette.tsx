"use client";

// Cmd-K command palette. Global keyboard shortcut (Cmd-K / Ctrl-K)
// opens a fuzzy-search dialog over every wallet the connected user
// has a role in, plus a few global actions ("Create wallet",
// "Disconnect"). cmdk handles the keyboard nav (↑↓, Enter, Esc) and
// the matching algorithm.
//
// Mobile: invoked from a sidebar trigger button (Cmd-K isn't a real
// shortcut on touch devices).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import * as Dialog from "@radix-ui/react-dialog";
import { useQuery } from "@tanstack/react-query";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  CheckCircle2,
  Clock,
  ClipboardList,
  LogOut,
  Plus,
  RefreshCcw,
  Rocket,
  Search,
  ShieldCheck,
  Users,
  Wallet,
  X,
  Zap,
} from "lucide-react";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { useOnboarding } from "@/lib/hooks/useOnboarding";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { useUserIntents } from "@/lib/hooks/useUserIntents";
import { ProposalStatus, IntentType } from "@/lib/msig";

type CommandPaletteHandle = {
  open: () => void;
  close: () => void;
  toggle: () => void;
};

let globalHandle: CommandPaletteHandle | null = null;

/// Programmatic open (used by the mobile sidebar trigger). Returns
/// whether the palette mounted yet.
export function openCommandPalette(): boolean {
  if (!globalHandle) return false;
  globalHandle.open();
  return true;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wallet = useWallet();
  const { reset } = useOnboarding();
  const address = wallet.publicKey?.toBase58() ?? "";

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  // Pull every proposal + intent across the user's wallets so the
  // palette is a real "jump anywhere" surface, not just a wallet
  // switcher. Both hooks share queryKey infrastructure with the
  // sidebar / detail pages so this isn't extra RPC.
  const allProposals = useRecentActivity(Number.POSITIVE_INFINITY);
  const allIntents = useUserIntents();

  // Cmd-K (mac) / Ctrl-K (everywhere else) toggles the palette.
  // Esc closes (cmdk handles that automatically when the dialog is open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Expose programmatic handle for non-keyboard triggers.
  useEffect(() => {
    globalHandle = {
      open: () => setOpen(true),
      close: () => setOpen(false),
      toggle: () => setOpen((o) => !o),
    };
    return () => {
      globalHandle = null;
    };
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const goto = useCallback(
    (path: string) => {
      close();
      router.push(path);
    },
    [router, close]
  );

  const wallets = memberships.data ?? [];

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command palette"
      className="fixed inset-0 z-[200] flex items-start justify-center p-4 sm:p-8"
    >
      {/* Visually hidden Radix DialogTitle + Description so screen
          readers (and the runtime a11y check) have something to bind to.
          cmdk's `label` prop only sets aria-label on the root, which
          Radix Dialog v1.1+ no longer treats as a complete substitute. */}
      <Dialog.Title className="sr-only">Command palette</Dialog.Title>
      <Dialog.Description className="sr-only">
        Search wallets, proposals, and intents. Use arrow keys to navigate, enter to select, escape to close.
      </Dialog.Description>

      {/* backdrop */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={close}
        className="absolute inset-0 -z-10 cursor-default bg-black/50 backdrop-blur-sm"
      />

      <div className="mt-[10vh] flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2 text-white/70">
          <Search size={14} />
          <Command.Input
            placeholder="Search wallets, proposals, intents…"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
          <kbd className="hidden rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50 sm:inline">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto px-2 py-2 text-sm">
          <Command.Empty className="px-3 py-6 text-center text-xs text-white/40">
            No matches.
          </Command.Empty>

          {wallets.length > 0 && (
            <Command.Group
              heading="My wallets"
              className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-white/40"
            >
              {wallets.map((m) => {
                const name = m.wallet_name ?? "";
                const value = `wallet:${m.wallet_name ?? m.wallet}`;
                const isApprover = m.roles.includes("approver");
                if (!name) {
                  // Unnamed memberships can't be navigated to; surface
                  // the PDA so the user can copy it manually.
                  return (
                    <Command.Item
                      key={m.wallet}
                      value={value}
                      onSelect={() => {
                        navigator.clipboard?.writeText(m.wallet);
                        close();
                      }}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/50 aria-selected:bg-white/10"
                    >
                      <Wallet size={14} className="text-white/40" />
                      <span className="truncate font-mono">
                        {m.wallet.slice(0, 6)}…{m.wallet.slice(-4)}
                      </span>
                      <span className="ml-auto text-[10px] text-white/30">
                        copy PDA
                      </span>
                    </Command.Item>
                  );
                }
                return (
                  <Command.Item
                    key={m.wallet}
                    value={value}
                    onSelect={() => goto(`/app/wallet/${encodeURIComponent(name)}`)}
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-brand-green/15 aria-selected:text-brand-green"
                  >
                    <Wallet size={14} />
                    <span className="truncate font-semibold">{name}</span>
                    {isApprover ? (
                      <ShieldCheck size={10} className="ml-auto text-white/30" />
                    ) : m.roles.includes("proposer") ? (
                      <Users size={10} className="ml-auto text-white/30" />
                    ) : null}
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {allProposals.rows.length > 0 && (
            <Command.Group
              heading="Proposals"
              className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-white/40"
            >
              {allProposals.rows.slice(0, 30).map((p) => {
                const StatusIcon =
                  p.status === ProposalStatus.Executed
                    ? Rocket
                    : p.status === ProposalStatus.Approved
                    ? CheckCircle2
                    : p.status === ProposalStatus.Cancelled
                    ? X
                    : Clock;
                const statusTone =
                  p.status === ProposalStatus.Executed
                    ? "text-brand-green"
                    : p.status === ProposalStatus.Approved
                    ? "text-cyan-300"
                    : p.status === ProposalStatus.Cancelled
                    ? "text-rose-300"
                    : "text-amber-300";
                return (
                  <Command.Item
                    key={p.proposalPda}
                    value={`proposal:${p.walletName} ${p.proposalIndex} ${p.proposalPda} ${p.statusLabel}`}
                    onSelect={() =>
                      goto(`/app/proposals/${encodeURIComponent(p.proposalPda)}`)
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-brand-green/15 aria-selected:text-brand-green"
                  >
                    <StatusIcon size={12} className={statusTone} />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate font-semibold">
                        {p.walletName}
                      </span>
                      <span className="font-mono text-white/40">
                        #{p.proposalIndex.toString()}
                      </span>
                    </span>
                    <span className="ml-auto font-mono text-[10px] uppercase tracking-wide text-white/40">
                      {p.statusLabel}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {allIntents.rows.length > 0 && (
            <Command.Group
              heading="Intents"
              className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-white/40"
            >
              {allIntents.rows.slice(0, 30).map((it) => {
                // Meta-intents (Add/Remove/Update) are scaffolding; only
                // surface user-authored Custom intents in the palette.
                if (it.intentType !== IntentType.Custom) return null;
                return (
                  <Command.Item
                    key={`${it.walletPda}-${it.intentIndex}`}
                    value={`intent:${it.walletName} ${it.intentIndex} ${it.template}`}
                    onSelect={() =>
                      goto(`/app/wallet/${encodeURIComponent(it.walletName)}`)
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-brand-green/15 aria-selected:text-brand-green"
                  >
                    <ClipboardList size={12} className="text-white/40" />
                    <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
                      <span className="truncate font-semibold">
                        {it.walletName}
                      </span>
                      <span className="font-mono text-white/40">
                        #{it.intentIndex}
                      </span>
                    </span>
                    <span className="ml-2 truncate font-mono text-[10px] text-white/40">
                      {it.template.slice(0, 36)}
                      {it.template.length > 36 ? "…" : ""}
                    </span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          <Command.Group
            heading="Actions"
            className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-white/40"
          >
            <Command.Item
              value="action:create-wallet"
              onSelect={() => goto("/app/wallet")}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-brand-green/15 aria-selected:text-brand-green"
            >
              <Plus size={14} />
              Create new wallet
            </Command.Item>
            <Command.Item
              value="action:show-intro"
              onSelect={() => {
                reset();
                close();
              }}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-white/10"
            >
              <RefreshCcw size={14} />
              Show intro again
            </Command.Item>
            {wallet.connected && (
              <Command.Item
                value="action:disconnect"
                onSelect={() => {
                  wallet.disconnect();
                  close();
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-rose-300 aria-selected:bg-rose-500/15"
              >
                <LogOut size={14} />
                Disconnect wallet
              </Command.Item>
            )}
          </Command.Group>
        </Command.List>

        <div className="flex items-center justify-between border-t border-white/10 px-3 py-2 text-[10px] text-white/40">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono">↑↓</kbd>
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono">↵</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-white/10 bg-white/5 px-1 py-0.5 font-mono">⌘K</kbd>
            toggle
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}
