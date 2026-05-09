"use client";

// Banner shown when the connected wallet cannot sign clear-msig's
// offchain-wrapped messages. Two known causes today, picked via
// `wallet.signerIssue`:
//
//   "waas"    - Dynamic's embedded WaaS-SVM signer UTF-8-decodes the
//               message bytes before signing. Our offchain envelope
//               starts with `\xff`, an invalid UTF-8 byte that gets
//               replaced with U+FFFD, so the signature ends up over
//               different bytes than we asked for. The CLI's verifier
//               rejects every signed write.
//
//   "phantom" - Phantom's signMessage rejects bytes whose first byte
//               looks like a Solana versioned-transaction prefix
//               (`0x80 | version`). The Solana offchain-message spec
//               mandates `\xff` as the first byte (`0x80 | 0x7f`), so
//               every clear-msig payload trips the heuristic and
//               Phantom throws "You cannot sign solana transactions
//               using sign message". Phantom currently has no
//               documented exemption for the spec'd offchain envelope.
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

  const isPhantom = wallet.signerIssue === "phantom";

  const defaultTitle = isPhantom
    ? "Phantom can't sign clear-msig messages right now"
    : "Email sign-in can't sign on Solana right now";

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
          {isPhantom ? (
            <>
              <p className={"mt-1 text-text-soft " + (compact ? "text-[11px]" : "text-xs")}>
                Phantom rejects the standard Solana offchain-message
                format that clear-msig uses for clear-signing. To create
                wallets and send transactions, sign out and reconnect
                with <strong>Solflare</strong>, <strong>Backpack</strong>,
                or <strong>Coinbase Wallet</strong> from the same wallet
                picker. For hardware-tier security,{" "}
                <Link
                  href="/security"
                  className="font-medium text-accent underline-offset-2 hover:underline"
                >
                  connect a Ledger
                </Link>
                . Your Phantom wallet still receives funds and shows
                balance fine.
              </p>
              {!compact && (
                <a
                  href="https://docs.phantom.com/solana/signing-a-message"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-text-soft hover:text-text-strong"
                >
                  Phantom&rsquo;s signMessage docs
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </>
          ) : (
            <>
              <p className={"mt-1 text-text-soft " + (compact ? "text-[11px]" : "text-xs")}>
                Dynamic&rsquo;s embedded TSS Solana wallet has a known
                UTF-8 issue that corrupts the message bytes before
                signing. To create wallets and send transactions, sign
                out and sign back in with{" "}
                <strong>Solflare, Backpack</strong>, or{" "}
                <strong>Coinbase Wallet</strong> from the same wallet
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
