"use client";

// Chains showcase. One card per supported chain, each rendering a
// clear-signed message the way it would appear on a Ledger when that
// chain is in flight.
//
// Renders as an infinite horizontal marquee rolling to the left.
// Shares the Phase 6 card tokens with every other landing card so
// proportions stay identical everywhere.

import Image from "next/image";
import { motion } from "framer-motion";
import {
  Coins,
  Leaf,
  type LucideIcon,
} from "lucide-react";
import { AutoHScroller } from "@/components/landing/AutoHScroller";
import {
  CARD,
  MARQUEE_GAP,
  MARQUEE_ITEM_WIDTH,
} from "@/components/landing/cardTokens";

export interface ChainShowcase {
  label: string;
  sub: string;
  scheme: string;
  tone: "emerald" | "sky" | "amber" | "violet" | "yellow";
  logo: { kind: "image"; src: string; alt: string } | { kind: "icon"; Icon: LucideIcon };
  message: Array<[string, string, string?]>;
}

export const CHAINS: ChainShowcase[] = [
  {
    label: "Solana",
    sub: "native transfer",
    scheme: "Ed25519",
    tone: "emerald",
    logo: { kind: "image", src: "/assets/solana.png", alt: "Solana" },
    message: [
      ["action", "approve transfer"],
      ["amount", "12.5", "SOL"],
      ["to", "7xP3…Rq2"],
    ],
  },
  {
    label: "Ethereum",
    sub: "EIP-1559",
    scheme: "secp256k1 ECDSA",
    tone: "sky",
    logo: { kind: "image", src: "/assets/ethereum.png", alt: "Ethereum" },
    message: [
      ["action", "approve send"],
      ["amount", "0.5", "ETH"],
      ["to", "0x71Ca…Ae23"],
    ],
  },
  {
    label: "ERC-20",
    sub: "token transfer",
    scheme: "secp256k1 ECDSA",
    tone: "violet",
    logo: { kind: "icon", Icon: Coins },
    message: [
      ["action", "transfer"],
      ["amount", "250k", "USDC"],
      ["to", "0x9fC3…BbE7"],
    ],
  },
  {
    label: "Bitcoin",
    sub: "P2WPKH",
    scheme: "BIP143 sighash",
    tone: "amber",
    logo: { kind: "image", src: "/assets/bitcoin.png", alt: "Bitcoin" },
    message: [
      ["action", "approve send"],
      ["amount", "0.025", "BTC"],
      ["to", "bc1q…fA5"],
    ],
  },
  {
    label: "Zcash",
    sub: "transparent",
    scheme: "ZIP-243 sighash",
    tone: "yellow",
    logo: { kind: "icon", Icon: Leaf },
    message: [
      ["action", "approve send"],
      ["amount", "400", "ZEC"],
      ["to", "t1…Quy"],
    ],
  },
];

const TONE_CLASSES: Record<
  ChainShowcase["tone"],
  { border: string; glow: string; accent: string; chipBg: string; chipText: string }
> = {
  emerald: {
    border: "border-brand-green/30",
    glow: "bg-brand-green/20",
    accent: "text-brand-green",
    chipBg: "bg-brand-green/15",
    chipText: "text-brand-green",
  },
  sky: {
    border: "border-sky-400/30",
    glow: "bg-sky-400/20",
    accent: "text-sky-300",
    chipBg: "bg-sky-400/15",
    chipText: "text-sky-300",
  },
  amber: {
    border: "border-amber-400/30",
    glow: "bg-amber-400/20",
    accent: "text-amber-300",
    chipBg: "bg-amber-400/15",
    chipText: "text-amber-300",
  },
  violet: {
    border: "border-violet-400/30",
    glow: "bg-violet-400/20",
    accent: "text-violet-300",
    chipBg: "bg-violet-400/15",
    chipText: "text-violet-200",
  },
  yellow: {
    border: "border-yellow-300/30",
    glow: "bg-yellow-300/20",
    accent: "text-yellow-200",
    chipBg: "bg-yellow-300/15",
    chipText: "text-yellow-100",
  },
};

export function ChainsGridSection() {
  return (
    <section id="chains" className="w-full lg:hidden">
      <AutoHScroller
        durationSec={42}
        direction="left"
        itemClass={MARQUEE_ITEM_WIDTH}
        gapClass={MARQUEE_GAP}
      >
        {CHAINS.map((chain, i) => (
          <ChainCard key={chain.label} chain={chain} index={i} />
        ))}
      </AutoHScroller>
    </section>
  );
}

export function ChainCard({ chain, index }: { chain: ChainShowcase; index: number }) {
  const tone = TONE_CLASSES[chain.tone];
  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4, delay: index * 0.04 }}
      className={`group relative flex h-full flex-col ${CARD.gapInner} overflow-hidden ${CARD.radius} border bg-black ${CARD.padding} shadow-card-dark ${tone.border}`}
    >
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full blur-3xl ${tone.glow}`}
      />

      <div className="relative z-10 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`flex items-center justify-center ${CARD.iconWrap} ${CARD.iconWrapRadius} border border-white/10 bg-white/5`}
          >
            {chain.logo.kind === "image" ? (
              <Image
                src={chain.logo.src}
                alt={chain.logo.alt}
                width={22}
                height={22}
                className={`${CARD.iconSize} object-contain`}
              />
            ) : (
              <chain.logo.Icon className={`${CARD.iconSize} ${tone.accent}`} />
            )}
          </div>
          <div className="min-w-0">
            <p className={`truncate font-display ${CARD.title} font-bold leading-tight text-white`}>
              {chain.label}
            </p>
            <p className={`truncate ${CARD.mono} font-semibold uppercase tracking-widest text-white/40`}>
              {chain.sub}
            </p>
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 ${CARD.mono} font-bold uppercase tracking-wide ${tone.chipBg} ${tone.chipText}`}
        >
          live
        </span>
      </div>

      <div
        className={`relative z-10 rounded-[clamp(0.5rem,1vw,0.875rem)] bg-white/[0.03] p-[clamp(0.4rem,0.9vw,0.75rem)] font-mono ${CARD.body} text-white/80`}
      >
        {chain.message.map(([label, value, extra]) => (
          <div key={label} className="flex gap-1.5">
            <span className="shrink-0 text-white/40">{label}</span>
            <span className="truncate">
              <span className="font-bold text-white">{value}</span>
              {extra && <span className="ml-1 text-white/60">{extra}</span>}
            </span>
          </div>
        ))}
      </div>

      <p className={`relative z-10 ${CARD.mono} font-mono text-white/40`}>
        {chain.scheme}
      </p>
    </motion.article>
  );
}
