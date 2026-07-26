"use client";

// Banner shown only when the wallet runtime has positively identified
// a signer that cannot pass ClearSign's byte-preservation check. Do not
// block by connector name alone; Dynamic embedded wallets are allowed
// to try and are guarded by local ed25519 verification before submit.

import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useWallet } from "@/lib/wallet";

interface UnsupportedSignerBannerProps {
  /// Override the default headline. Defaults to a cause-specific one.
  title?: string;
  /// Optional dense rendering for inline placement.
  compact?: boolean;
}

export function UnsupportedSignerBanner({
  title,
  compact,
}: UnsupportedSignerBannerProps) {
  const wallet = useWallet();
  if (!wallet.signerIssue) return null;

  const defaultTitle = "This signer cannot finish ClearSign safely";

  return (
    <div
      role="alert"
      className={
        "rounded-card border border-warning/40 bg-warning/[0.07] text-text-strong " +
        (compact ? "p-3 text-xs" : "p-4 text-sm")
      }
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle
          className={
            "shrink-0 text-warning " + (compact ? "mt-0.5 h-3.5 w-3.5" : "mt-0.5 h-4 w-4")
          }
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title ?? defaultTitle}</p>
          <p className={"mt-1 text-text-soft " + (compact ? "text-[11px]" : "text-xs")}>
            This signer failed ClearSign&rsquo;s byte-preservation safety
            check. Use Solflare, Backpack, Phantom, Coinbase Wallet, or
            try again with a fresh Dynamic embedded wallet. For
            hardware-tier security,{" "}
            <Link
              href="/security"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              connect a Ledger
            </Link>
            . Nothing moves until a compatible signer approves.
          </p>
          {!compact && (
            <a
              href="https://docs.dynamic.xyz/embedded-wallets/embedded-wallets-providers/solana"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-text-soft hover:text-text-strong"
            >
              About Dynamic&rsquo;s Solana embedded wallet
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
