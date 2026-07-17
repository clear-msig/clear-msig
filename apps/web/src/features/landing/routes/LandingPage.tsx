"use client";

import { useReducedMotion } from "framer-motion";
import { LandingAtmospherics, LandingNav } from "@/components/landing/LandingChrome";
import { LandingBackToTop, LandingScrollProgress } from "@/components/landing/LandingScrollUI";
import { SecureSection } from "@/components/landing/SecureSection";
import { AgentControlSection } from "@/features/landing/ui/home/AgentControlSection";
import { Bento } from "@/features/landing/ui/home/Bento";
import { ChainMarquee } from "@/features/landing/ui/home/ChainMarquee";
import { Footer } from "@/features/landing/ui/home/Footer";
import { Hero } from "@/features/landing/ui/home/Hero";
import { WhyClear } from "@/features/landing/ui/home/WhyClear";

export default function HomePage() {
  const reduce = useReducedMotion();

  // Scroll-reveal factory. Switched from animate-on-mount to
  // `whileInView` with `once: true` so each section blooms as the
  // user scrolls past it - the page reveals itself rather than
  // dumping every section at once. Hero still fires immediately
  // because it's already in viewport at page load (amount: 0.18
  // satisfies). `margin: -10%` pulls the trigger up a bit so the
  // reveal starts just before each section's top edge enters.
  const fadeIn = (delay = 0) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y: 28 },
          whileInView: { opacity: 1, y: 0 },
          viewport: { once: true, amount: 0.18, margin: "0px 0px -10% 0px" },
          transition: { duration: 0.7, delay, ease: [0.22, 1, 0.36, 1] as const },
        };

  return (
    // Bleed-to-edge full-bleed shell. The previous floating-rounded
    // container with ring + shadow has been removed; the obsidian
    // canvas blends from viewport edge to edge while the inner
    // sections stay capped at max-w-[1600px]. Sticky nav lives
    // OUTSIDE the overflow-hidden atmospherics wrapper so the sticky
    // positioning works (sticky doesn't survive an overflow:hidden
    // ancestor).
    <div className="landing-shell relative min-h-screen bg-[#0c0c0c] text-[#ebebeb]">
      {/* Scroll progress strip (lime accent, top of viewport) and a
          floating back-to-top button. Both are client-only, respect
          reduced-motion, and stay above the atmospherics layer. */}
      <LandingScrollProgress />
      <LandingBackToTop />

      {/* atmospherics live in their own absolute overflow-hidden
          wrapper that sits behind sections (z-0) - so the sticky
          nav can layer above them without clipping. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LandingAtmospherics />
      </div>

      <LandingNav />

      <main className="relative mx-auto w-full max-w-[1600px]">
        <Hero fadeIn={fadeIn} />

        <ChainMarquee />

        <Bento fadeIn={fadeIn} />

        <WhyClear fadeIn={fadeIn} />

        <AgentControlSection fadeIn={fadeIn} />

        <SecureSection />

        <Footer fadeIn={fadeIn} />
      </main>
    </div>
  );
}
