"use client";

// SendChainPicker. Strip of chips at the top of the wallet's send
// pages showing every chain the wallet can act on. Solana is always
// present. Ethereum shows up when bound; tapping it routes to
// /app/wallet/[name]/send/eth (or to the per-chain setup page when
// the EvmTransfer intent isn't there yet). Bitcoin is fully enabled.
// Zcash is surfaced the same way as the other live chains.
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
import { chainSendSubtitle } from "@/lib/chain/send-support";

export function SendChainPicker({
  walletName,
  activeKind,
}: {
  walletName: string;
  activeKind: number;
}) {
  const { options, loading } = useSendChains(walletName);
  if (loading) {
    return (
      <div
        className="mb-5 flex animate-pulse flex-wrap items-center gap-2"
        aria-hidden="true"
      >
        <div className="h-[58px] w-32 rounded-card border border-border-soft bg-surface-raised" />
        <div className="h-[58px] w-36 rounded-card border border-border-soft bg-surface-raised" />
      </div>
    );
  }
  // Bound + setup-needed chains are tappable. needs_binding chains
  // are hidden from the row (the trailing "Add chain" tile is the
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
        const disabled = opt.status === "coming_soon" || !href;
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
              <span className="text-[10px] text-text-soft">
                {chainSendSubtitle(opt.status)}
              </span>
            </span>
          </span>
        );
        if (disabled || !href) {
          return (
            <span
              key={opt.chain.kind}
              aria-disabled
              className="hidden md:inline-flex"
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
            {boundCount === 1 ? "Send ETH, BTC, ZEC, HYPE" : "More chains"}
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
  if (kind === 2) {
    // Bitcoin: setup + send live in the same /send/btc page (it
    // detects whether the BTC intent already exists and either
    // offers a one-tap setup or jumps to the compose form).
    return `/app/wallet/${encodeURIComponent(walletName)}/send/btc`;
  }
  if (kind === 3) {
    return `/app/wallet/${encodeURIComponent(walletName)}/send/zec`;
  }
  if (kind === 5) {
    return status === "needs_setup"
      ? `/app/wallet/${encodeURIComponent(walletName)}/setup/eth?network=hyperliquid`
      : `/app/wallet/${encodeURIComponent(walletName)}/send/eth?network=hyperliquid`;
  }
  return null;
}
