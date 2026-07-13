"use client";

// SendChainPicker. Strip of chips at the top of the wallet's send
// pages showing every chain the wallet can act on. Solana is always
// present. Ethereum shows up when bound; tapping it routes to
// /app/wallet/[name]/send/eth (or to the per-chain setup page when
// the EvmTransfer intent isn't there yet). Bitcoin uses the same
// readiness check as the BTC send page, so old 6-param intents do not
// show as ready.
//
// activeKind dims the current chain so the user knows where they
// are. Always renders - even on a Solana-only wallet - so the
// "Add chain" tile at the end is reachable from the send page.
// Was self-hiding when ≤1 chain was bound, which left users with
// no obvious entry point to add a second chain.

import Link from "next/link";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useSendChains } from "@/lib/hooks/useSendChains";
import { ChainBadge } from "@/components/retail/ChainBadge";
import { chainSendSubtitle } from "@/lib/chain/send-support";

const HeldAssetPicker = dynamic(
  () =>
    import("@/components/retail/HeldAssetPicker").then(
      (module) => module.HeldAssetPicker,
    ),
  { ssr: false, loading: () => null },
);

export function SendChainPicker({
  walletName,
  activeKind,
}: {
  walletName: string;
  activeKind: number | null;
}) {
  const { options, loading } = useSendChains(walletName);
  if (loading) {
    const solana = options.find((option) => option.chain.kind === 0);
    const solanaHref = `/app/wallet/${encodeURIComponent(walletName)}/send?asset=solana`;
    return (
      <nav aria-label="Choose what to send" className="mb-4">
        <div className="flex items-center gap-2 overflow-x-auto rounded-card border border-border-soft bg-surface-raised/80 p-1.5 shadow-card-rest backdrop-blur">
          {solana ? (
            <Link href={solanaHref} className="block shrink-0">
              <span className="flex h-12 min-w-[8.25rem] items-center gap-2 rounded-soft border border-accent/40 bg-canvas px-2.5 text-left text-text-strong shadow-card-rest">
                <ChainBadge chain={solana.chain} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-xs font-medium text-text-strong">
                    Solana
                  </span>
                  <span className="truncate text-[10px] text-text-soft">
                    Available now
                  </span>
                </span>
              </span>
            </Link>
          ) : null}
          <div
            className="h-12 w-36 shrink-0 animate-pulse rounded-soft border border-border-soft bg-canvas"
            aria-label="Loading other assets"
          />
        </div>
      </nav>
    );
  }
  // Show every sendable asset state here. /send is now the user's
  // single asset chooser: ready assets open the send form, missing
  // assets start the same "turn on sending" path.
  const visible = options;
  // Always render the row - even with only Solana bound - because
  // the trailing "Add chain" tile is now part of the row, not a
  // hidden affordance.
  const addChainHref = `/app/wallet/${encodeURIComponent(walletName)}/chains/add?autostart=1`;
  return (
    <nav aria-label="Choose what to send" className="mb-4">
      <div className="flex items-center gap-2 overflow-x-auto rounded-card border border-border-soft bg-surface-raised/80 p-1.5 shadow-card-rest backdrop-blur md:pb-1.5">
        {visible.map((opt) => {
          const isActive = opt.chain.kind === activeKind;
          const href = sendHrefFor(walletName, opt.chain, opt.status);
          const disabled = opt.status === "coming_soon" || !href;
          const tile = (
            <span
              className={
                "flex h-12 min-w-[8.25rem] items-center gap-2 rounded-soft border px-2.5 text-left " +
                "transition-[border-color,background-color,color] duration-base ease-out-soft " +
                (disabled
                  ? "cursor-not-allowed opacity-60 border-border-soft bg-canvas"
                  : isActive
                    ? "border-accent bg-canvas text-text-strong shadow-card-rest"
                    : "border-transparent bg-transparent hover:bg-canvas hover:text-text-strong")
              }
            >
              <ChainBadge chain={opt.chain} size="sm" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-xs font-medium text-text-strong">
                  {opt.chain.name}
                </span>
                <span className="truncate text-[10px] text-text-soft">
                  {isActive ? "Selected" : chainSendSubtitle(opt.status)}
                </span>
              </span>
            </span>
          );
          if (disabled || !href) {
            return (
              <span
                key={opt.chain.kind}
                aria-disabled
                className="hidden shrink-0 md:inline-flex"
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
              className="block shrink-0"
            >
              {tile}
            </Link>
          );
        })}

        {/* Compact add-asset control keeps the picker calm while preserving
          the route into chain management from every send page. */}
        <Link
          href={addChainHref}
          aria-label="Turn on another asset"
          title="Turn on another asset"
          className={
            "ml-auto flex h-12 w-12 shrink-0 items-center justify-center rounded-soft border border-border-soft bg-canvas text-text-soft " +
            "transition-[border-color,background-color,color] duration-base ease-out-soft " +
            "hover:border-accent/40 hover:bg-accent/5 hover:text-accent " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <Plus className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          <span className="sr-only">Turn on another asset</span>
        </Link>
      </div>
      <HeldAssetPicker walletName={walletName} activeKind={activeKind} />
    </nav>
  );
}

function sendHrefFor(
  walletName: string,
  chain: { kind: number; apiName: string },
  status: "ready" | "needs_setup" | "needs_binding" | "coming_soon",
): string | null {
  const kind = chain.kind;
  if (status === "coming_soon") return null;
  if (status === "needs_binding") {
    return `/app/wallet/${encodeURIComponent(walletName)}/chains/add?chain=${encodeURIComponent(chain.apiName)}&autostart=1`;
  }
  if (kind === 0) {
    return `/app/wallet/${encodeURIComponent(walletName)}/send?asset=solana`;
  }
  if (kind === 1) {
    return status === "needs_setup"
      ? `/app/wallet/${encodeURIComponent(walletName)}/setup/eth?autostart=1`
      : `/app/wallet/${encodeURIComponent(walletName)}/send/eth`;
  }
  if (kind === 2) {
    // Bitcoin: setup + send live in the same /send/btc page (it
    // detects whether the BTC intent already exists and either
    // offers a one-tap setup or jumps to the compose form).
    return status === "needs_setup"
      ? `/app/wallet/${encodeURIComponent(walletName)}/send/btc?autostart=1`
      : `/app/wallet/${encodeURIComponent(walletName)}/send/btc`;
  }
  if (kind === 3) {
    return status === "needs_setup"
      ? `/app/wallet/${encodeURIComponent(walletName)}/send/zec?autostart=1`
      : `/app/wallet/${encodeURIComponent(walletName)}/send/zec`;
  }
  if (kind === 5) {
    return status === "needs_setup"
      ? `/app/wallet/${encodeURIComponent(walletName)}/setup/eth?network=hyperliquid&autostart=1`
      : `/app/wallet/${encodeURIComponent(walletName)}/send/eth?network=hyperliquid`;
  }
  return null;
}
