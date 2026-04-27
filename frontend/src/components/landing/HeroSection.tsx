"use client";

// Landing hero. One sentence, one scroll prompt, one animated terminal.
//
// The hero intentionally holds back the wallet-connect action. The
// Connect Wallet CTA lives only inside the closing VaultConnectSection
// so that readers absorb the "why" before the "how". A soft scroll
// prompt here replaces the old top button and points downward instead.

import { motion, useReducedMotion } from "framer-motion";
import { TerminalTyping } from "@/components/landing/TerminalTyping";

export function HeroSection() {
  const reduce = useReducedMotion();

  return (
    <section
      id="hero"
      className="relative flex w-full flex-col items-center gap-12 pt-6 lg:flex-row lg:gap-16 lg:pt-10"
    >
      {/* Copy column. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
        className="flex flex-1 flex-col items-center gap-5 text-center lg:items-start lg:text-left"
      >
        <span className="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/70 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-black/70 shadow-sm backdrop-blur">
          <span
            aria-hidden="true"
            className="relative h-2 w-2 rounded-full bg-brand-green"
          >
            <span className="absolute inset-0 animate-ping rounded-full bg-brand-green/80" />
          </span>
          Ika pre-alpha · Solana devnet
        </span>

        <h1 className="font-display text-hero-sm font-bold leading-[1.02] tracking-ultra-tight text-black text-balance sm:text-hero-md lg:text-hero-lg xl:text-hero-xl">
          Sign intents.
          <br />
          <span className="relative inline-block bg-gradient-to-br from-brand-emerald via-brand-green to-brand-green-bright bg-clip-text text-transparent">
            Not hex.
            <span
              aria-hidden="true"
              className="absolute -bottom-1 left-0 h-[3px] w-full rounded-full bg-gradient-to-r from-brand-emerald via-brand-green to-brand-green-bright opacity-70"
            />
          </span>
        </h1>

        <p className="max-w-xl text-base font-medium leading-relaxed text-black/70 text-pretty sm:text-lg">
          A Solana multisig where every signature is a sentence your Ledger
          can read. One policy controls Ethereum, Bitcoin, and Solana
          treasuries. No MetaMask. No blind signing. Zero gas for signers.
        </p>


      </motion.div>

      {/* Terminal column. */}
      <motion.div
        initial={reduce ? false : { opacity: 0, rotateY: 18, rotateX: 6, rotateZ: -2 }}
        animate={{ opacity: 1, rotateY: 9, rotateX: 3, rotateZ: -1.5 }}
        transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
        className="perspective-1000 w-full max-w-[420px] flex-1 drop-shadow-2xl lg:max-w-[520px]"
      >
        <TerminalTyping />
      </motion.div>
    </section>
  );
}
