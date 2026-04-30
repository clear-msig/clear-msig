"use client";

// Architecture. Three trust zones, rendered as a slow marquee that
// drifts to the right. Uses the shared Phase 6 card tokens so every
// zone card matches the sizes and proportions of every other landing
// card.

import { motion } from "framer-motion";
import { Globe, Network, Shield } from "lucide-react";
import { AutoHScroller } from "@/components/landing/AutoHScroller";
import {
  CARD,
  MARQUEE_GAP,
  MARQUEE_ITEM_WIDTH,
  SECTION,
} from "@/components/landing/cardTokens";

const ZONES = [
  {
    label: "Your browser",
    trust: "you hold the keys",
    tone: "brand",
    Icon: Globe,
    items: [
      "Your wallet signs plain-English intents",
      "Direct reads from Solana",
      "Signatures never leave your device",
    ],
  },
  {
    label: "Multisig policy",
    trust: "gasless, on chain",
    tone: "neutral",
    Icon: Shield,
    items: [
      "Thresholds and timelocks enforced in the program",
      "Each ed25519 signature verified byte for byte",
      "Zero gas fee for signers, always",
    ],
  },
  {
    label: "Ika MPC dWallets",
    trust: "cross-chain reach",
    tone: "brand",
    Icon: Network,
    items: [
      "Native signatures for Ethereum, ERC-20 tokens, Bitcoin and Zcash",
      "Driven from Solana via a single authority",
      "Threshold signing on the Ika network (pre-alpha mock signer)",
    ],
  },
] as const;

type Zone = (typeof ZONES)[number];

export function ArchitectureSection() {
  return (
    <section id="architecture" className="w-full">
      <div className="mx-auto max-w-3xl text-center">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full bg-black/5 px-3 py-1 ${SECTION.eyebrow} font-bold uppercase tracking-widest text-black/70`}
        >
          Architecture
        </span>
        <h2 className={`mt-3 font-display ${SECTION.title} font-bold leading-[1.05] tracking-tight text-black text-balance`}>
          Three trust zones. No custody in the middle.
        </h2>
        <p className={`mt-2 ${SECTION.body} text-black/60`}>
          Your signature never leaves the browser. Every rule lives on chain.
          Cross-chain keys live inside a distributed MPC network.
        </p>
      </div>

      <AutoHScroller
        className="mt-8 sm:mt-10"
        durationSec={60}
        direction="right"
        itemClass={MARQUEE_ITEM_WIDTH}
        gapClass={MARQUEE_GAP}
      >
        {ZONES.map((zone, i) => (
          <ZoneCard key={zone.label} zone={zone} index={i} />
        ))}
      </AutoHScroller>

      <p className={`mt-6 text-center ${CARD.mono} font-mono uppercase tracking-widest text-black/40`}>
        trust boundary · your signature never leaves the browser
      </p>
    </section>
  );
}

function ZoneCard({ zone, index }: { zone: Zone; index: number }) {
  const Icon = zone.Icon;
  const isBrand = zone.tone === "brand";
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.5, delay: index * 0.08 }}
      className={
        isBrand
          ? `relative flex h-full flex-col ${CARD.gapInner} ${CARD.radius} border border-brand-green/30 bg-black ${CARD.padding} text-white shadow-card-dark`
          : `relative flex h-full flex-col ${CARD.gapInner} ${CARD.radius} border border-black/10 bg-white/90 ${CARD.padding} text-black shadow-card-shadow backdrop-blur`
      }
    >
      <div className="flex items-center justify-between gap-2">
        <div
          className={
            isBrand
              ? `flex items-center justify-center ${CARD.iconWrap} ${CARD.iconWrapRadius} bg-brand-green/15 text-brand-green`
              : `flex items-center justify-center ${CARD.iconWrap} ${CARD.iconWrapRadius} bg-black text-brand-green`
          }
        >
          <Icon className={CARD.iconSize} />
        </div>
        <span
          className={
            isBrand
              ? `rounded-full bg-brand-green/15 px-2 py-0.5 ${CARD.mono} font-bold uppercase tracking-wide text-brand-green`
              : `rounded-full bg-black/5 px-2 py-0.5 ${CARD.mono} font-bold uppercase tracking-wide text-black/70`
          }
        >
          {zone.trust}
        </span>
      </div>
      <h3
        className={
          isBrand
            ? `font-display ${CARD.title} font-bold leading-tight tracking-tight text-white`
            : `font-display ${CARD.title} font-bold leading-tight tracking-tight text-black`
        }
      >
        {zone.label}
      </h3>
      <ul className={`flex flex-col gap-1 ${CARD.body}`}>
        {zone.items.map((it) => (
          <li key={it} className={isBrand ? "text-white/70" : "text-black/65"}>
            · {it}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
