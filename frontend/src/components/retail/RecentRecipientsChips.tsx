"use client";

// Recent recipients — Cash-App-style list of the last few people
// this wallet sent to on a given chain. Each row is:
//
// Each chip fills the recipient input with the full address. We
// short the address for display so the strip stays compact, and
// only render entries that recorded `recipientFull` - older log
// entries have only the truncated `recipientShort` and we can't
// fill an input from that.

import { useEffect, useState } from "react";
import { History } from "lucide-react";
import {
  recentRecipients,
  subscribe,
  type RecentRecipient,
} from "@/lib/retail/txLog";
import { findByAddress } from "@/lib/retail/contacts";
import { shortAddress } from "@/lib/retail/contacts";
import { shortEvmAddress, isValidEvmAddress } from "@/lib/chain/eth";
import { MemberAvatar } from "@/components/retail/MemberAvatar";
import { relativeTime } from "@/lib/util/relativeTime";

interface Props {
  walletName: string;
  chainKind: number;
  onPick: (address: string) => void;
  /// How many rows to show. Default 4.
  limit?: number;
}

export function RecentRecipientsChips({
  walletName,
  chainKind,
  onPick,
  limit = 4,
}: Props) {
  const [items, setItems] = useState<RecentRecipient[]>([]);

  useEffect(() => {
    const refresh = () => {
      setItems(recentRecipients(walletName, chainKind, limit));
    };
    refresh();
    return subscribe(refresh);
  }, [walletName, chainKind, limit]);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
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
              // min-h-tap (44px) so each chip is reliably tappable.
              // Was h≈20 (py-1+text-[11px]), well below HIG. Visual
              // size barely changes because the type stays at 11px;
              // the box just gains breathing room above and below.
              "inline-flex min-h-tap items-center gap-1.5 rounded-full border border-border-soft bg-surface-raised px-3 py-2 text-[11px] font-medium text-text-soft " +
              "transition-[border-color,color,transform] duration-base ease-out-soft " +
              "hover:-translate-y-0.5 hover:text-accent " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            }
            title={`Use ${it.address}`}
          >
            <span className="font-mono text-text-strong">
              {shortEvmAddress(it.address)}
            </span>
          </button>
        ))}
      </ul>
    </div>
  );
}

function RecipientRow({
  recipient,
  onPick,
}: {
  recipient: RecentRecipient;
  onPick: (address: string) => void;
}) {
  // Try contact lookup first — case-insensitive for EVM, exact for
  // Solana. Falls back to the short address as the heading when no
  // contact match exists.
  const contact =
    findByAddress(recipient.address) ??
    findByAddress(recipient.address.toLowerCase()) ??
    findByAddress(recipient.address.toUpperCase());

  const isEvm = isValidEvmAddress(recipient.address);
  const display = contact?.name ?? shortenAddress(recipient.address, isEvm);
  const showShortBeneath = !!contact;

  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(recipient.address)}
        title={`Use ${recipient.address}`}
        className={
          "group flex w-full items-center gap-3 rounded-card border border-border-soft bg-surface-raised px-3 py-2 text-left " +
          "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
          "hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card-rest " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        }
      >
        <MemberAvatar address={recipient.address} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-text-strong">
            {display}
          </span>
          <span className="truncate text-[11px] text-text-soft">
            {showShortBeneath && (
              <>
                {shortenAddress(recipient.address, isEvm)}
                {" · "}
              </>
            )}
            {relativeTime(recipient.ts)}
            {recipient.count > 1 && (
              <>
                {" · "}sent {recipient.count}×
              </>
            )}
          </span>
        </span>
        {recipient.amountDisplay && (
          <span className="shrink-0 text-right">
            <span className="block font-numerals text-sm font-semibold text-text-strong tabular-nums">
              {recipient.amountDisplay}
            </span>
            {recipient.ticker && (
              <span className="block font-display text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
                {recipient.ticker}
              </span>
            )}
          </span>
        )}
      </button>
    </li>
  );
}

function shortenAddress(address: string, isEvm: boolean): string {
  if (isEvm) return shortEvmAddress(address);
  return shortAddress(address);
}
