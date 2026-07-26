"use client";

// Connected-identity hero card. Refactored to use the same header-
// strip pattern as the Vault summary on /app/secure/new so the
// product reads as one consistent surface across pages.
//
// Layout:
//   ┌──────────────────────────────────────────────────────┐
//   │ YOUR WALLET                            ● Connected   │  ← strip
//   ├──────────────────────────────────────────────────────┤
//   │  ⬢   Wallet · Solana devnet                          │
//   │      ┌──────────────────────────┐                    │
//   │      │ 9abc…f3d2          Copy │                    │
//   │      └──────────────────────────┘                    │
//   │      Friends use this when they send you …           │
//   └──────────────────────────────────────────────────────┘

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { Check, Copy } from "lucide-react";
import { useWallet } from "@/lib/wallet";
import { MemberAvatar } from "@/components/retail/MemberAvatar";

export function IdentityCard() {
  const wallet = useWallet();
  const address = wallet.publicKey?.toBase58() ?? "";
  const short = useMemo(
    () => (address ? `${address.slice(0, 4)}…${address.slice(-4)}` : ""),
    [address],
  );

  // "Wallet kind" chip: Ledger / Wallet. Could grow to distinguish
  // Embedded vs External in the future; the hook surfaces enough to
  // do that without changing this component's shape.
  const kindLabel = wallet.isLedger ? "Ledger" : "Wallet";

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      /* clipboard blocked - silent */
    }
  };

  return (
    <section className="overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      {/* Header strip - eyebrow on the left, live status pill on
          the right. Mirrors the Vault summary card on /app/secure/new. */}
      <header className="flex items-center justify-between border-b border-border-soft px-5 py-3 sm:px-6">
        <span className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
          Your wallet
        </span>
        {address ? (
          <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
            Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
            Disconnected
          </span>
        )}
      </header>

      <div className="px-5 py-5 sm:px-6 sm:py-6">
        {address ? (
          <>
            {/* Avatar + identity meta. Stacks on mobile when the
                avatar is large, sits inline on sm+. */}
            <div className="flex items-start gap-4">
              <MemberAvatar address={address} size="lg" />
              <div className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-soft">
                  {kindLabel} · Solana devnet
                </span>
                <p className="mt-1 font-display text-base font-semibold tracking-[-0.01em] text-text-strong">
                  Signed in as {short}
                </p>
              </div>
            </div>

            {/* Copyable full address row */}
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? "Address copied" : "Copy your wallet address"}
              className={clsx(
                "group mt-5 flex w-full items-center justify-between gap-3 rounded-xl border border-border-soft bg-canvas px-4 py-3",
                "transition-[border-color,transform,box-shadow] duration-base ease-out-soft",
                "hover:-translate-y-0.5 hover:border-accent/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              )}
            >
              <span className="truncate font-mono text-[13px] text-text-strong">
                {short}
              </span>
              <span
                className={clsx(
                  "flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em]",
                  "transition-colors duration-base ease-out-soft",
                  copied
                    ? "text-accent"
                    : "text-text-soft group-hover:text-accent",
                )}
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" strokeWidth={3} />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </span>
            </button>

            <p className="mt-3 text-[12px] leading-relaxed text-text-soft">
              Friends use this address when they want to send you money
              outside a shared wallet.
            </p>
          </>
        ) : (
          <p className="text-[14px] text-text-soft">
            You&rsquo;re not connected yet. Sign in to manage your account.
          </p>
        )}
      </div>
    </section>
  );
}
