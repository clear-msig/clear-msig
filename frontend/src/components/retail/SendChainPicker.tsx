"use client";

// SendChainPicker. Strip of chips at the top of the wallet's send
// pages showing every chain the wallet can act on. Solana is always
// present. Ethereum shows up when bound; tapping it routes to
// /app/wallet/[name]/send/eth (or to the per-chain setup page when
// the EvmTransfer intent isn't there yet). BTC / Zcash render as
// "Coming soon" until UTXO management lands.
//
// activeKind dims the current chain so the user knows where they
// are. The picker self-hides when only one chain is available, so
// Solana-only wallets don't get visual chrome they can't use.

import Link from "next/link";
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
  if (loading || options.length === 0) return null;
  const visible = options.filter(
    (o) => o.status !== "needs_binding" || o.chain.kind === 0,
  );
  if (visible.length <= 1) return null;
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
                  : "border-border-soft bg-surface-raised hover:-translate-y-px hover:border-accent/40")
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
            <span key={opt.chain.kind} aria-disabled>
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
