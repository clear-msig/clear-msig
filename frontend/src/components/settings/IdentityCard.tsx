"use client";

// Connected-identity hero - used on the Account page as the lead card
// and reused inside Settings before the Account split. Shows the
// avatar, a "Connected" pulse, and a copyable short address. Stays
// dumb: pulls everything from useWallet().

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
    <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        Your wallet
      </p>

      {address ? (
        <>
          <div className="mt-3 flex items-center gap-3">
            <MemberAvatar address={address} size="lg" />
            <p className="inline-flex items-center gap-2 text-base text-text-strong">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent/70 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
              </span>
              Connected
            </p>
          </div>
          <button
            type="button"
            onClick={handleCopy}
            aria-label={copied ? "Address copied" : "Copy your wallet address"}
            className={clsx(
              "group mt-4 flex w-full items-center justify-between gap-3 rounded-card border border-border-soft bg-canvas px-4 py-3",
              "transition-[border-color,transform,box-shadow] duration-base ease-out-soft",
              "hover:-translate-y-0.5 hover:shadow-card-rest",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
            )}
          >
            <span className="font-mono text-sm text-text-strong">{short}</span>
            <span
              className={clsx(
                "flex shrink-0 items-center gap-1 text-xs font-semibold uppercase tracking-wide",
                "transition-colors duration-base ease-out-soft",
                copied
                  ? "text-accent"
                  : "text-text-soft group-hover:text-accent",
              )}
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </span>
          </button>
          <p className="mt-2 text-xs text-text-soft">
            Friends use this when they want to send you money outside a
            shared wallet.
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-text-soft">
          You&rsquo;re not connected.
        </p>
      )}
    </section>
  );
}
