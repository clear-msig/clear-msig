"use client";

// How it works. Four step cards shown as an infinite horizontal
// marquee rolling to the right.
//
// No section header is rendered. The cards themselves are the
// narrative. Each step card mirrors the shape of the Architecture
// zone cards (icon + chip + title + 3 bullet items) so the whole
// page reads with a single visual rhythm.

import { motion } from "framer-motion";
import { FileText, PenLine, Cog, Rocket } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AutoHScroller } from "@/components/landing/AutoHScroller";
import {
  CARD,
  MARQUEE_GAP,
  MARQUEE_ITEM_WIDTH,
} from "@/components/landing/cardTokens";

export interface Step {
  title: string;
  stage: string;
  items: string[];
  Icon: LucideIcon;
}

export const STEPS: Step[] = [
  {
    stage: "stage one",
    title: "Propose",
    Icon: FileText,
    items: [
      "Pick an intent from the catalogue",
      "Fill in the typed parameters",
      "Preview the exact signed bytes",
    ],
  },
  {
    stage: "stage two",
    title: "Approve",
    Icon: PenLine,
    items: [
      "Co-signers sign the same sentence",
      "Wallets render the readable intent",
      "No hex, no calldata, no guessing",
    ],
  },
  {
    stage: "stage three",
    title: "Execute",
    Icon: Cog,
    items: [
      "Thresholds verified on chain",
      "Ed25519 signatures checked byte by byte",
      "Ika dWallet dispatched for the chain",
    ],
  },
  {
    stage: "stage four",
    title: "Broadcast",
    Icon: Rocket,
    items: [
      "Ika MPC produces a native signature",
      "Relayed to Ethereum, Bitcoin, or Solana",
      "Your treasury moves in one click",
    ],
  },
];

export function HowItWorksSection() {
  return (
    <section id="how-it-works" className="w-full lg:hidden">
      <AutoHScroller
        durationSec={38}
        direction="right"
        itemClass={MARQUEE_ITEM_WIDTH}
        gapClass={MARQUEE_GAP}
      >
        {STEPS.map((step, i) => (
          <StepCard key={step.title} step={step} index={i} />
        ))}
      </AutoHScroller>
    </section>
  );
}

export function StepCard({ step, index }: { step: Step; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.4 }}
      className={`relative flex h-full flex-col ${CARD.gapInner} ${CARD.radius} border border-black/10 bg-white/90 ${CARD.padding} shadow-card-shadow backdrop-blur`}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={`inline-flex items-center justify-center ${CARD.iconWrap} ${CARD.iconWrapRadius} bg-black text-brand-green`}
        >
          <step.Icon className={CARD.iconSize} />
        </span>
        <span
          className={`rounded-full bg-black/5 px-2 py-0.5 ${CARD.mono} font-bold uppercase tracking-wide text-black/70`}
        >
          {step.stage}
        </span>
      </div>
      <h3
        className={`font-display ${CARD.title} font-bold leading-tight tracking-tight text-black`}
      >
        {String(index + 1).padStart(2, "0")}. {step.title}
      </h3>
      <ul className={`flex flex-col gap-1 ${CARD.body}`}>
        {step.items.map((item) => (
          <li key={item} className="text-black/65">
            · {item}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}
