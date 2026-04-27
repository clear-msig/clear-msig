"use client";

// The problem. Three concrete incidents that landed because signers
// trusted a UI instead of reading the bytes.
//
// All card chrome uses the shared Phase 6 card tokens so the three
// dark incident cards line up perfectly with every other landing card
// at every screen size.

import { motion } from "framer-motion";
import { Skull, ShieldOff, Eye, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { CARD, SECTION } from "@/components/landing/cardTokens";

interface IncidentCard {
  headline: string;
  sub: string;
  loss?: string;
  Icon: LucideIcon;
}

const INCIDENTS: IncidentCard[] = [
  {
    headline: "Bybit signers approved a swap they couldn't read.",
    sub: "Hardware wallets showed a hash. Attackers showed a UI. $1.4B later, the industry still hadn't learned.",
    loss: "$1.4B",
    Icon: Skull,
  },
  {
    headline: "Drift admin keys signed the wrong calldata.",
    sub: "The transaction looked fine in MetaMask. The contract did something else. Classic blind-sign outcome.",
    loss: "admin compromised",
    Icon: ShieldOff,
  },
  {
    headline: "You: still signing `0x8f2a…` and hoping.",
    sub: "Hardware wallets show the hash. MetaMask shows calldata. Neither tells you what you're actually approving.",
    loss: "every single day",
    Icon: Eye,
  },
];

export function ProblemSection() {
  return (
    <section
      id="problem"
      className="relative w-full overflow-hidden rounded-[clamp(1.25rem,2.5vw,2.5rem)] border border-rose-500/10 bg-gradient-to-br from-rose-50/70 via-white/80 to-white px-[clamp(1rem,2.5vw,2.5rem)] py-[clamp(2.5rem,5vw,5rem)]"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-20 top-0 h-[420px] w-[420px] rounded-full bg-rose-400/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 bottom-0 h-[420px] w-[420px] rounded-full bg-amber-400/10 blur-3xl"
      />

      <div className="relative z-10 mx-auto max-w-3xl text-center">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-rose-500/10 px-3 py-1 ${SECTION.eyebrow} font-bold uppercase tracking-widest text-rose-700`}
        >
          <AlertTriangle className="h-3 w-3" /> The blind-signing crisis
        </span>
        <h2 className={`mt-4 font-display ${SECTION.title} font-bold leading-[1.05] tracking-tight text-black text-balance`}>
          Every multisig hack ever was somebody trusting a UI.
        </h2>
        <p className={`mt-2 ${SECTION.body} text-black/60`}>
          Hardware wallets show you the <em>hash</em>, not the action.
          Attackers exploit the gap between what the UI says and what the
          bytes actually do.
        </p>
      </div>

      <div className="relative z-10 mt-10 grid gap-[clamp(0.625rem,1.2vw,1.25rem)] md:grid-cols-3">
        {INCIDENTS.map((it, i) => (
          <motion.article
            key={it.headline}
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-80px" }}
            transition={{ duration: 0.45, delay: i * 0.08 }}
            className={`relative flex flex-col ${CARD.gapInner} overflow-hidden ${CARD.radius} border border-black/10 bg-black ${CARD.padding} text-white shadow-card-dark`}
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-rose-500/20 blur-2xl"
            />
            <div className="relative z-10 flex items-center justify-between gap-2">
              <div className={`flex items-center justify-center ${CARD.iconWrap} ${CARD.iconWrapRadius} bg-rose-500/15 text-rose-300`}>
                <it.Icon className={CARD.iconSize} />
              </div>
              {it.loss && (
                <span className={`rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-0.5 font-mono ${CARD.mono} font-bold uppercase tracking-wider text-rose-200`}>
                  {it.loss}
                </span>
              )}
            </div>
            <h3 className={`relative z-10 font-display ${CARD.title} font-semibold leading-snug tracking-tight text-white text-balance`}>
              {it.headline}
            </h3>
            <p className={`relative z-10 ${CARD.body} text-white/60`}>
              {it.sub}
            </p>
          </motion.article>
        ))}
      </div>
    </section>
  );
}
