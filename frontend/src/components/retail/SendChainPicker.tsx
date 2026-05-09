"use client";

// SendChainPicker. Strip of chips at the top of the wallet's send
// pages showing every chain the wallet can act on. Solana is always
// present. Ethereum shows up when bound; tapping it routes to
// /app/wallet/[name]/send/eth (or to the per-chain setup page when
// the EvmTransfer intent isn't there yet). BTC / Zcash render as
// "Coming soon" until UTXO management lands.
//
// activeKind dims the current chain so the user knows where they
// are. Always renders - even on a Solana-only wallet - so the
// "Add chain" tile at the end is reachable from the send page.
// Was self-hiding when ≤1 chain was bound, which left users with
// no obvious entry point to add a second chain.

import Link from "next/link";
import { Plus } from "lucide-react";
import { useSendChains } from "@/lib/hooks/useSendChains";
import { ChainBadge } from "@/components/retail/ChainBadge";

export function SendChainPicker({
  walletName,
  activeKind,
}: {
  walletName: string;
  activeKind: number;
}) {
  const { options, loading } = useSendChains(walletName);
  if (loading) return null;
  // Bound + setup-needed chains are tappable. Coming-soon chains
  // are desktop-only discovery chrome. needs_binding chains are
  // hidden from the row (the trailing "Add chain" tile is the
  // right entry point for adding new ones).
  const visible = options.filter((o) => o.status !== "needs_binding");
  const boundCount = options.filter(
    (o) => o.status === "ready" || o.status === "needs_setup",
  ).length;
  // Always render the row - even with only Solana bound - because
  // the trailing "Add chain" tile is now part of the row, not a
  // hidden affordance.
  const addChainHref = `/app/wallet/${encodeURIComponent(walletName)}/chains/add`;
  return (
    <nav
      aria-label="Send chain"
      className="mb-5 flex flex-wrap items-center gap-2"
    >
      {visible.map((opt) => {
        const isActive = opt.chain.kind === activeKind;
        const href = sendHrefFor(walletName, opt.chain.kind, opt.status);
        const subtitle = subtitleFor(opt.status);
        const disabled = opt.status === "coming_soon";
        const tile = (
          <span
            className={
              "flex items-center gap-2 rounded-card border px-3 py-2 text-left " +
              "transition-[border-color,background-color,transform] duration-base ease-out-soft " +
              (disabled
                ? "cursor-not-allowed opacity-60 border-border-soft bg-canvas"
                : isActive
                  ? "border-accent bg-accent/5 shadow-card-rest"
                  : "border-border-soft bg-surface-raised hover:-translate-y-px")
            }
          >
            <ChainBadge chain={opt.chain} size="sm" />
            <span className="flex flex-col">
              <span className="text-xs font-medium text-text-strong">
                {opt.chain.name}
              </span>
              <span className="text-[10px] text-text-soft">{subtitle}</span>
            </span>
          </span>
        );
        if (disabled || !href) {
          return (
            <span
              key={opt.chain.kind}
              aria-disabled
              // Coming-soon tiles hidden on mobile - they're a
              // discovery affordance for desktop, not a tappable
              // option. Keeping them on mobile ate ~2/3 of the
              // 375px row.
              className={disabled ? "hidden md:inline-flex" : ""}
            >
              {tile}
            </span>
          );
        }
        return (
          <Link
            key={opt.chain.kind}
            href={href}
            aria-current={isActive ? "page" : undefined}
          >
            {tile}
          </Link>
        );
      })}

      {/* Add-chain tile - always rendered as the last item so users
          can find the chain-management flow without leaving /send.
          Solana-only wallets see this as the only secondary tile;
          multi-chain wallets see it after their bound chains.
          Subtitle adapts so the row reads as a single thought. */}
      <Link
        href={addChainHref}
        aria-label="Add another chain"
        className={
          "flex items-center gap-2 rounded-card border border-dashed border-border-soft bg-surface-raised px-3 py-2 text-left " +
          "transition-[border-color,background-color,transform] duration-base ease-out-soft " +
          "hover:-translate-y-px hover:bg-accent/5 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <span
          aria-hidden="true"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent"
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} />
        </span>
        <span className="flex flex-col">
          <span className="text-xs font-medium text-text-strong">
            Add chain
          </span>
          <span className="text-[10px] text-text-soft">
            {boundCount === 1 ? "Send ETH, BTC, ZEC" : "More chains"}
          </span>
        </span>
      </Link>
    </nav>
  );
}

function sendHrefFor(
  walletName: string,
  kind: number,
  status: "ready" | "needs_setup" | "needs_binding" | "coming_soon",
): string | null {
  if (status === "coming_soon") return null;
  if (status === "needs_binding") {
    return `/app/wallet/${encodeURIComponent(walletName)}/chains/add`;
  }
  if (kind === 0) {
    return `/app/wallet/${encodeURIComponent(walletName)}/send`;
  }
  if (kind === 1) {
    return status === "needs_setup"
      ? `/app/wallet/${encodeURIComponent(walletName)}/setup/eth`
      : `/app/wallet/${encodeURIComponent(walletName)}/send/eth`;
  }
  return null;
}

function subtitleFor(
  status: "ready" | "needs_setup" | "needs_binding" | "coming_soon",
): string {
  switch (status) {
    case "ready":
      return "Ready";
    case "needs_setup":
      return "Set up sending";
    case "needs_binding":
      return "Add chain";
    case "coming_soon":
      return "Coming soon";
  }
}
