"use client";

// Before / After. Red hex on the left vs. green clear-signed intent
// on the right: the narrative pivot of the whole landing page.
//
// Mobile (<md): the two panes stack vertically with a glowing arrow
//               pointing downward between them, so the reader's eye
//               travels from "blind signing" down into "clear
//               signing" naturally.
// md and up:    classic three-column layout, pane on the left, a
//               glowing arrow pointing right in the middle, pane on
//               the right.
//
// Both panes use the shared Phase 6 card tokens so their type and
// proportions match every other card on the landing page.

import { motion } from "framer-motion";
import { ArrowRight, XCircle, CheckCircle2 } from "lucide-react";
import { CARD, SECTION } from "@/components/landing/cardTokens";

const BLIND_HEX =
  "0x8f2a1b9c00000000000000000000000074ce5a3b000000000000000000000000a1b2c3d4e5f60708090a0b0c0d0e0f00000000000000000000000000000000000000000000000000002386f26fc1000000000000000000000000000000000000000000000000000000000000000000";

export function BeforeAfterSection() {
  return (
    <section id="fix" className="w-full">
      <div className="mx-auto max-w-3xl text-center">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-brand-green/15 px-3 py-1 ${SECTION.eyebrow} font-bold uppercase tracking-widest text-brand-green`}
        >
          The fix
        </span>
        <h2 className={`mt-4 font-display ${SECTION.title} font-bold leading-[1.05] tracking-tight text-black text-balance`}>
          One signature. Two very different meanings.
        </h2>
        <p className={`mt-2 ${SECTION.body} text-black/60`}>
          On the left, what your Ledger shows today. On the right, what it
          shows when the multisig speaks human.
        </p>
      </div>

      {/* Mobile: vertical stack with a glowing arrow pointing down. */}
      <div className="mt-10 flex flex-col items-stretch gap-4 md:hidden">
        <BeforePane />
        <GlowingArrow orientation="down" />
        <AfterPane />
      </div>

      {/* md and up: three-column layout with a glowing arrow pointing
          right. */}
      <div className="mt-10 hidden items-stretch gap-[clamp(0.75rem,1.2vw,1.5rem)] md:grid md:grid-cols-[1fr_auto_1fr]">
        <BeforePane />
        <div className="flex items-center justify-center">
          <GlowingArrow orientation="right" />
        </div>
        <AfterPane />
      </div>
    </section>
  );
}

function GlowingArrow({ orientation }: { orientation: "down" | "right" }) {
  return (
    <div className="flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.6 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5, delay: 0.2 }}
        className="relative flex h-[clamp(2.5rem,3vw,3.5rem)] w-[clamp(2.5rem,3vw,3.5rem)] items-center justify-center rounded-full bg-brand-green text-black shadow-glow"
      >
        {/* Outer expanding halo. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 animate-ping rounded-full bg-brand-green/40"
        />
        {/* Soft static glow ring behind the button. */}
        <span
          aria-hidden="true"
          className="absolute -inset-2 rounded-full bg-brand-green/20 blur-md"
        />
        <ArrowRight
          className={`relative z-10 h-[clamp(1rem,1.3vw,1.25rem)] w-[clamp(1rem,1.3vw,1.25rem)] transition-transform ${
            orientation === "down" ? "rotate-90" : ""
          }`}
        />
      </motion.div>
    </div>
  );
}

function BeforePane() {
  return (
    <motion.div
      initial={{ opacity: 0, x: -16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5 }}
      className={`relative flex h-full flex-col ${CARD.gapInner} overflow-hidden ${CARD.radius} border border-rose-500/20 bg-black ${CARD.padding} shadow-card-dark`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-rose-500/20 blur-2xl"
      />
      <div className="relative z-10 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 font-bold uppercase tracking-widest text-rose-300 ${CARD.eyebrow}`}>
          <XCircle className="h-3 w-3" /> Blind signing
        </span>
        <span className={`font-mono text-rose-300/60 ${CARD.mono}`}>
          what you sign today
        </span>
      </div>
      <pre className={`relative z-10 max-h-52 overflow-auto rounded-[clamp(0.5rem,1vw,0.875rem)] bg-rose-500/[0.05] p-[clamp(0.5rem,1vw,1rem)] font-mono ${CARD.body} break-all whitespace-pre-wrap text-rose-100`}>
        {BLIND_HEX}
      </pre>
      <div className={`relative z-10 flex items-center justify-between ${CARD.mono} text-rose-200/80`}>
        <span>
          <span className="font-bold">?</span> Is this a withdrawal?
        </span>
        <span>
          <span className="font-bold">?</span> Who is the recipient?
        </span>
      </div>
      <span className={`relative z-10 rounded-lg bg-rose-500/10 px-3 py-2 font-semibold text-rose-200 ${CARD.mono}`}>
        Sign this and pray.
      </span>
    </motion.div>
  );
}

function AfterPane() {
  return (
    <motion.div
      initial={{ opacity: 0, x: 16 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className={`relative flex h-full flex-col ${CARD.gapInner} overflow-hidden ${CARD.radius} border border-brand-green/30 bg-black ${CARD.padding} shadow-glow`}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand-green/20 blur-2xl"
      />
      <div className="relative z-10 flex items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1.5 font-bold uppercase tracking-widest text-brand-green ${CARD.eyebrow}`}>
          <CheckCircle2 className="h-3 w-3" /> Clear signing
        </span>
        <span className={`font-mono text-brand-green/60 ${CARD.mono}`}>
          what Clear-MSIG signs
        </span>
      </div>
      <div className={`relative z-10 rounded-[clamp(0.5rem,1vw,0.875rem)] bg-brand-green/[0.04] p-[clamp(0.5rem,1vw,1rem)] font-mono ${CARD.body} text-white`}>
        <div>
          <span className="text-white/40">expires</span>{" "}
          <span className="text-white/80">2026-04-20 18:00</span>:
        </div>
        <div className="mt-1">
          <span className="text-white/40">action</span>{" "}
          <span className="font-bold text-brand-green-bright">approve</span>{" "}
          <span className="text-white/80">
            transfer <span className="font-bold text-white">0.5 ETH</span> to{" "}
            <span className="font-bold text-white">0x71Ca…Ae23</span>
          </span>
        </div>
        <div className="mt-1">
          <span className="text-white/40">wallet</span>{" "}
          <span className="text-white/80">treasury</span>
          <span className="text-white/40"> · </span>
          <span className="text-white/40">proposal</span>{" "}
          <span className="text-white/80">42</span>
        </div>
      </div>
      <ul className={`relative z-10 grid grid-cols-2 gap-1.5 text-brand-green ${CARD.mono}`}>
        <li className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> every byte verifiable
        </li>
        <li className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> Ledger reads it
        </li>
        <li className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> on-chain policy-gated
        </li>
        <li className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" /> reproducible hash
        </li>
      </ul>
      <span className={`relative z-10 rounded-lg bg-brand-green/10 px-3 py-2 font-semibold text-brand-green ${CARD.mono}`}>
        Sign what you actually mean.
      </span>
    </motion.div>
  );
}
