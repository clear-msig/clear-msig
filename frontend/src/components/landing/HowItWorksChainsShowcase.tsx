"use client";

// Desktop-only combined showcase for How it works and Every chain.
//
// No headers. Just the two infinite marquees, stacked with a
// breathing gap between them. How it works rolls to the right on
// the top track; Chains rolls to the left on the bottom track.
// Opposite directions give the section its visual tension without
// any textual crutch.
//
// Card sizes and spacing come from the shared Phase 6 tokens in
// `cardTokens.ts`, so these desktop cards match the mobile cards in
// every other section exactly in proportion.

import { AutoHScroller } from "@/components/landing/AutoHScroller";
import {
  CHAINS,
  ChainCard,
} from "@/components/landing/ChainsGridSection";
import {
  STEPS,
  StepCard,
} from "@/components/landing/HowItWorksSection";
import { MARQUEE_GAP, MARQUEE_ITEM_WIDTH } from "@/components/landing/cardTokens";

export function HowItWorksChainsShowcase() {
  return (
    <section
      id="flow"
      className="hidden w-full lg:block"
    >
      <div className="flex flex-col gap-[clamp(1.25rem,2vw,2.25rem)]">
        <AutoHScroller
          durationSec={42}
          direction="right"
          itemClass={MARQUEE_ITEM_WIDTH}
          gapClass={MARQUEE_GAP}
          fadeFrom="background"
        >
          {STEPS.map((step, i) => (
            <StepCard key={step.title} step={step} index={i} />
          ))}
        </AutoHScroller>

        <AutoHScroller
          durationSec={48}
          direction="left"
          itemClass={MARQUEE_ITEM_WIDTH}
          gapClass={MARQUEE_GAP}
          fadeFrom="background"
        >
          {CHAINS.map((chain, i) => (
            <ChainCard key={chain.label} chain={chain} index={i} />
          ))}
        </AutoHScroller>
      </div>
    </section>
  );
}
