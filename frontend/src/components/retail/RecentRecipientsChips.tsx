"use client";

// Quick-pick strip of the user's most-recent send targets for a
// given wallet+chain. Mirrors the recentContacts(4) UX on the
// Solana send page; EVM doesn't have a contacts integration yet
// (the contacts module validates as base58), so we read from the
// localStorage txLog instead.
//
// Each chip fills the recipient input with the full address. We
// short the address for display so the strip stays compact, and
// only render entries that recorded `recipientFull` — older log
// entries have only the truncated `recipientShort` and we can't
// fill an input from that.

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import { recentRecipients } from "@/lib/retail/txLog";
import { shortEvmAddress } from "@/lib/chain/eth";
import { subscribe } from "@/lib/retail/txLog";

interface Props {
  walletName: string;
  chainKind: number;
  onPick: (address: string) => void;
  /// How many chips to show. Default 4 matches the Solana
  /// recentContacts strip.
  limit?: number;
}

export function RecentRecipientsChips({
  walletName,
  chainKind,
  onPick,
  limit = 4,
}: Props) {
  const [items, setItems] = useState<{ address: string; ticker: string }[]>([]);

  // Hydrate on mount + subscribe to log changes. We can't read
  // localStorage during render (SSR mismatch), so the initial state
  // is empty + filled in useEffect. Subscribing means the strip
  // refreshes automatically after a successful send on this page.
  useEffect(() => {
    const refresh = () => {
      setItems(
        recentRecipients(walletName, chainKind, limit).map((r) => ({
          address: r.address,
          ticker: r.ticker,
        })),
      );
    };
    refresh();
    return subscribe(refresh);
  }, [walletName, chainKind, limit]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        <History className="h-3 w-3" aria-hidden="true" />
        Recent
      </p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((it) => (
          <button
            key={it.address}
            type="button"
            onClick={() => onPick(it.address)}
            className={
              "inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-1 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color,transform] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:border-accent hover:text-accent " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
            title={`Use ${it.address}`}
          >
            <span className="font-mono text-text-strong">
              {shortEvmAddress(it.address)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
