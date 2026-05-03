"use client";

// WaaS limitation banner.
//
// Dynamic's WaaS-SVM signer (the embedded Solana wallet that backs
// email + social sign-in on this project) UTF-8-decodes message
// bytes before signing. Our offchain envelope starts with `\xff`,
// an invalid UTF-8 byte that gets replaced with U+FFFD, so the
// signature ends up over different bytes than we asked for and the
// CLI's verifier rejects every signed write.
//
// Until Dynamic ships a bytes-safe signer or your project enables
// Turnkey as the embedded provider, email/Google signups can sign
// in and view balances but can't create wallets, enable sending,
// or send transactions on Solana.
//
// This banner surfaces the limitation up-front so users don't keep
// hitting the per-action "wallet signed wrong bytes" toast. Mount
// on every signed-write entry point (dashboard, /welcome, /send).

import Link from "next/link";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { useWallet } from "@/lib/wallet";

interface WaasLimitationBannerProps {
  /// Override the default headline. Defaults to a generic one.
  title?: string;
  /// Optional dense rendering for inline placement.
  compact?: boolean;
}

export function WaasLimitationBanner({
  title,
  compact,
}: WaasLimitationBannerProps) {
  const wallet = useWallet();
  if (!wallet.isLossySigner) return null;

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
          <p className="font-medium">
            {title ?? "Email sign-in can't sign on Solana right now"}
          </p>
          <p className={"mt-1 text-text-soft " + (compact ? "text-[11px]" : "text-xs")}>
            Dynamic&rsquo;s embedded TSS Solana wallet has a known
            UTF-8 issue that corrupts the message bytes before signing.
            To create wallets and send transactions, sign out and sign
            back in with <strong>Phantom, Solflare, Backpack</strong>,
            or <strong>Coinbase Wallet</strong> from the same wallet
            picker. For hardware-tier security,{" "}
            <Link
              href="/security"
              className="font-medium text-accent underline-offset-2 hover:underline"
            >
              connect a Ledger
            </Link>
            . Your embedded wallet still receives funds and shows
            balance fine.
          </p>
          {!compact && (
            <a
              href="https://docs.dynamic.xyz/embedded-wallets/embedded-wallets-providers/solana"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-text-soft hover:text-text-strong"
            >
              About Dynamic&rsquo;s Solana provider
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
