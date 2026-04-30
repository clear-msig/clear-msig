"use client";

// Receive money — surface the wallet's vault address so the user (or
// anyone they share it with) can fund the wallet.
//
// The retail rule "no raw addresses on screen by default" is a
// guideline, not a ban. Receive is one of the deliberate exceptions:
// to add money, you literally need the address. We surface it as the
// hero element with a generous copy target, plain-language framing,
// and a quiet devnet reminder.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { useConnection } from "@solana/wallet-adapter-react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Copy, Wallet } from "lucide-react";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findVaultAddress } from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { Button } from "@/components/retail/Button";

export default function ReceivePage() {
  const params = useParams<{ name: string }>();
  const name = useMemo(() => {
    try {
      return decodeURIComponent(params?.name ?? "");
    } catch {
      return params?.name ?? "";
    }
  }, [params?.name]);

  const reduce = useReducedMotion();
  const { connection } = useConnection();

  const walletQuery = useQuery({
    queryKey: ["wallet", name],
    queryFn: () => fetchWalletByName(connection, name),
    enabled: name.length > 0,
    staleTime: 30_000,
  });

  // The vault PDA is what funders send to. Derived directly from the
  // wallet PDA — no separate query needed once we have the wallet.
  const vaultAddress = useMemo(() => {
    if (!walletQuery.data) return null;
    const [vault] = findVaultAddress(
      walletQuery.data.pda,
      CLEAR_WALLET_PROGRAM_ID,
    );
    return vault.toBase58();
  }, [walletQuery.data]);

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  const handleCopy = async () => {
    if (!vaultAddress) return;
    try {
      await navigator.clipboard.writeText(vaultAddress);
      setCopied(true);
    } catch {
      /* clipboard blocked — silent */
    }
  };

  const motionProps = reduce
    ? {}
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-gutter pt-6">
        <Link
          href={`/app/wallet/${encodeURIComponent(name)}`}
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {name}
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <motion.section
          {...motionProps}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-md"
        >
          <div className="flex flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Wallet className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
              Receive money
            </p>
            <h1 className="mt-2 font-display text-display-sm leading-[1.05] text-text-strong text-balance">
              Add money to {name}
            </h1>
            <p className="mt-3 max-w-sm text-base text-text-soft">
              Send SOL to the address below. Anyone with the address can
              fund the wallet — but only members can spend from it.
            </p>

            {/* Address card — generous tap target, clear visual focus. */}
            {vaultAddress ? (
              <div className="mt-8 w-full rounded-card border border-border-soft bg-surface-raised p-5 text-left shadow-card-rest">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-text-soft">
                  Wallet address
                </p>
                <p
                  className="mt-2 break-all font-mono text-sm leading-relaxed text-text-strong"
                  aria-label={`Wallet address: ${vaultAddress}`}
                >
                  {vaultAddress}
                </p>
                <button
                  type="button"
                  onClick={handleCopy}
                  aria-label={copied ? "Address copied" : "Copy wallet address"}
                  className={
                    "group mt-4 flex w-full items-center justify-center gap-2 rounded-soft border border-border-soft bg-canvas " +
                    "min-h-tap px-4 text-sm font-medium text-text-strong " +
                    "transition-[border-color,transform,box-shadow] duration-base ease-out-soft " +
                    "hover:-translate-y-0.5 hover:border-accent hover:shadow-card-rest active:scale-[0.98] " +
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
                  }
                >
                  {copied ? (
                    <>
                      <Check
                        className="h-4 w-4 text-accent"
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                      <span className="text-accent">Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" aria-hidden="true" />
                      Copy address
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="mt-8 h-44 w-full animate-pulse rounded-card border border-border-soft bg-surface-raised shadow-card-rest" />
            )}

            <p className="mt-4 max-w-sm text-xs text-text-soft">
              Sending money you can&rsquo;t afford to lose? Don&rsquo;t.
              This wallet is on a test network for now — only send test
              SOL.
            </p>

            <Link
              href={`/app/wallet/${encodeURIComponent(name)}`}
              className="mt-6 inline-block w-full"
            >
              <Button size="lg" variant="secondary" fullWidth>
                Back to {name}
              </Button>
            </Link>
          </div>
        </motion.section>
      </div>
    </main>
  );
}
