"use client";

// Banner shown when the connected wallet cannot sign clear-msig's
// offchain-wrapped messages. One known cause today:
//
//   "waas"    - Dynamic's embedded WaaS-SVM signer UTF-8-decodes the
//               message bytes before signing. Our offchain envelope
//               starts with `\xff`, an invalid UTF-8 byte that gets
//               replaced with U+FFFD, so the signature ends up over
//               different bytes than we asked for. The CLI's verifier
//               rejects every signed write.
//
// Mount on every signed-write entry point (dashboard, /welcome, /send).

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

  const defaultTitle = "This embedded wallet can't sign on Solana right now";

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
            A legacy embedded signer path can corrupt the message
            bytes before signing. Clear now routes new email / phone
            sign-ins through a compatible embedded wallet, but if you
            still land here, sign out and sign back in with{" "}
            <strong>Solflare, Backpack</strong>, or{" "}
            <strong>Coinbase Wallet</strong> from the same wallet
            picker. For hardware-tier security,{" "}
            <Link
              href="/security"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              connect a Ledger
            </Link>
            . Your connected wallet still receives funds and shows
            balance fine.
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
