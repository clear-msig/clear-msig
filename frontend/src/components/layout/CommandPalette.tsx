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
import { useWallet } from "@/lib/wallet";
import {
  CheckCircle2,
  Clock,
  LogOut,
  Plus,
  Rocket,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { fetchOnchainMemberships } from "@/lib/memberships/client";
import { useRecentActivity } from "@/lib/hooks/useRecentActivity";
import { ProposalStatus } from "@/lib/msig";
import { friendlyStatus } from "@/lib/retail/labels";
import { toDisplayName } from "@/lib/retail/walletNames";

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
  const address = wallet.publicKey?.toBase58() ?? "";

  const memberships = useQuery({
    queryKey: ["my-organizations", address],
    queryFn: () => fetchOnchainMemberships(address),
    enabled: address.length > 0,
    staleTime: 30_000,
  });

  // Pull every request across the user's wallets so the palette is a
  // real "jump anywhere" surface, not just a wallet switcher. Shares
  // queryKey infrastructure with the sidebar / detail pages so this
  // isn't extra RPC.
  const allProposals = useRecentActivity(Number.POSITIVE_INFINITY);

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
        Search your wallets and requests. Use arrow keys to navigate, enter to select, escape to close.
      </Dialog.Description>

      {/* backdrop */}
      <button
        type="button"
        aria-label="Close command palette"
        onClick={close}
        className="absolute inset-0 -z-10 cursor-default bg-surface-card/50 backdrop-blur-sm"
      />

      <div className="mt-[10vh] flex w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-border-soft bg-surface-card-strong shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2 text-white/70">
          <Search size={14} />
          <Command.Input
            placeholder="Search your wallets and requests…"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/30"
          />
          <kbd className="hidden rounded border border-border-soft bg-white/5 px-1.5 py-0.5 font-mono text-[10px] text-white/50 sm:inline">
            esc
          </kbd>
        </div>

        <Command.List className="max-h-[60vh] overflow-y-auto px-2 py-2 text-sm">
          <Command.Empty className="px-4 py-8 text-center">
            <p className="text-sm font-medium text-white/80">
              No matches
            </p>
            <p className="mt-1 text-xs text-white/40">
              Try a wallet name, a friend, or part of an action like
              &ldquo;send sarah&rdquo;.
            </p>
          </Command.Empty>

          {wallets.length > 0 && (
            <Command.Group
              heading="Your wallets"
              className="mb-2 [&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-widest [&_[cmdk-group-heading]]:text-white/40"
            >
              {wallets.map((m) => {
                const onChainName = m.wallet_name ?? "";
                if (!onChainName) return null; // Unnamed memberships are skipped - addresses don't belong on screen.
                const display = toDisplayName(onChainName);
                return (
                  <Command.Item
                    key={m.wallet}
                    // value drives the cmdk fuzzy matcher; include
                    // both the typed name and the on-chain form so
                    // power users can find a wallet either way.
                    value={`wallet:${display} ${onChainName}`}
                    onSelect={() =>
                      goto(`/app/wallet/${encodeURIComponent(onChainName)}`)
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-accent/15 aria-selected:text-accent"
                  >
                    <Wallet size={14} />
                    <span className="truncate font-medium">{display}</span>
                  </Command.Item>
                );
              })}
            </Command.Group>
          )}

          {allProposals.rows.length > 0 && (
            <Command.Group
              heading="Requests"
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
                    ? "text-success"
                    : p.status === ProposalStatus.Approved
                      ? "text-accent"
                      : p.status === ProposalStatus.Cancelled
                        ? "text-text-soft"
                        : "text-warning";
                const friendly = friendlyStatus(p.status);
                return (
                  <Command.Item
                    key={p.proposalPda}
                    value={`request:${toDisplayName(p.walletName)} ${friendly} ${p.proposalPda}`}
                    onSelect={() =>
                      goto(`/app/proposals/${encodeURIComponent(p.proposalPda)}`)
                    }
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-accent/15 aria-selected:text-accent"
                  >
                    <StatusIcon size={12} className={statusTone} />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {toDisplayName(p.walletName)}
                    </span>
                    <span className="ml-auto truncate text-[10px] text-white/40">
                      {friendly}
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
              value="action:new-wallet"
              onSelect={() => goto("/welcome")}
              className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs text-white/80 aria-selected:bg-accent/15 aria-selected:text-accent"
            >
              <Plus size={14} />
              New shared wallet
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

        <div className="flex items-center justify-between border-t border-border-soft px-3 py-2 text-[10px] text-white/40">
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border-soft bg-white/5 px-1 py-0.5 font-mono">↑↓</kbd>
            <kbd className="rounded border border-border-soft bg-white/5 px-1 py-0.5 font-mono">↵</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1">
            <kbd className="rounded border border-border-soft bg-white/5 px-1 py-0.5 font-mono">⌘K</kbd>
            toggle
          </span>
        </div>
      </div>
    </Command.Dialog>
  );
}
