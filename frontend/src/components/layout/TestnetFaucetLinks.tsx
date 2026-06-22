"use client";

import clsx from "clsx";
import { ExternalLink } from "lucide-react";

const FAUCETS = [
  {
    label: "Solana",
    network: "Devnet",
    href: "https://faucet.solana.com/",
  },
  {
    label: "Bitcoin",
    network: "Testnet",
    href: "https://coinfaucet.eu/en/btc-testnet/",
  },
  {
    label: "Ethereum",
    network: "Sepolia",
    href: "https://cloud.google.com/application/web3/faucet/ethereum/sepolia",
  },
] as const;

export function TestnetFaucetLinks({ itemClass }: { itemClass: string }) {
  return (
    <div className="border-t border-border-soft px-1.5 py-2">
      <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        Get test tokens
      </p>
      <div className="grid gap-1">
        {FAUCETS.map((faucet) => (
          <a
            key={faucet.href}
            role="menuitem"
            href={faucet.href}
            target="_blank"
            rel="noreferrer"
            className={clsx(itemClass, "justify-between")}
          >
            <span className="flex min-w-0 items-center gap-2">
              <ExternalLink size={14} aria-hidden="true" />
              <span className="truncate">{faucet.label}</span>
            </span>
            <span className="shrink-0 text-[10px] font-semibold text-text-muted">
              {faucet.network}
            </span>
          </a>
        ))}
      </div>
    </div>
  );
}
