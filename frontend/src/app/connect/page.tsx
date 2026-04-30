"use client";

// Connect — the dedicated wallet-selection page.
//
// Lifted out of the landing per the user request: the public landing
// no longer has a wallet-select button anywhere. CTAs that need a
// wallet (Get started, dashboard deep links, /welcome, /send) bounce
// here via `useWalletGate`, which appends a `?next=<original-path>`
// so we land them back where they meant to go after connecting.

import { Suspense } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ExternalLink, ShieldCheck } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWalletGate } from "@/lib/hooks/useWalletGate";

export default function ConnectPageWrapper() {
  return (
    <Suspense
      fallback={<main className="min-h-screen bg-canvas" aria-hidden="true" />}
    >
      <ConnectPage />
    </Suspense>
  );
}

function ConnectPage() {
  // The gate handles the post-connect redirect (?next or /app/wallet).
  // We just render the connect UI; the gate fires once `connected` flips.
  useWalletGate();
  const reduce = useReducedMotion();

  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 12 },
          animate: { opacity: 1, y: 0 },
          transition: {
            duration: 0.45,
            delay,
            ease: [0.22, 1, 0.36, 1] as const,
          },
        };

  return (
    <main className="relative flex min-h-screen flex-col bg-canvas">
      {/* Single soft accent wash — same atmosphere as the welcome flow. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="absolute -left-32 -top-16 h-[55vh] w-[80vw] max-w-[640px] rounded-full bg-accent/[0.06] blur-3xl" />
      </div>

      <header className="relative z-10 flex items-center justify-between px-gutter pt-6">
        <Link
          href="/"
          className={
            "-ml-2 inline-flex items-center gap-1.5 rounded-soft px-2 py-1 text-sm text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Clear
        </Link>
      </header>

      <div className="relative z-10 flex flex-1 items-center justify-center px-gutter py-10">
        <div className="w-full max-w-md">
          <motion.section
            {...fadeIn(0)}
            className="flex flex-col items-center text-center"
          >
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-accent/10 text-accent">
              <ShieldCheck className="h-7 w-7" strokeWidth={1.75} />
            </div>
            <h1 className="font-display text-display-sm leading-[1.05] text-text-strong">
              Connect your wallet
            </h1>
            <p className="mt-3 max-w-sm text-base text-text-soft">
              Your wallet is how Clear knows it&rsquo;s really you. We
              never see your keys — only your wallet does.
            </p>

            {/* The wallet-adapter button. Styled green via the
                wallet-adapter overrides in globals.css; uses the SDK's
                modal under the hood so we always pick up newly
                installed extensions without bookkeeping here. */}
            <motion.div {...fadeIn(0.08)} className="mt-8">
              <WalletMultiButton />
            </motion.div>

            <motion.a
              {...fadeIn(0.16)}
              href="https://phantom.app/download"
              target="_blank"
              rel="noreferrer"
              className={
                "mt-8 inline-flex items-center gap-1.5 text-sm text-text-soft " +
                "transition-colors duration-base ease-out-soft hover:text-text-strong " +
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas " +
                "rounded-soft px-2 py-1"
              }
            >
              Don&rsquo;t have a wallet yet? Get one
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </motion.a>
          </motion.section>
        </div>
      </div>
    </main>
  );
}
