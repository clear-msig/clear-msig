"use client";

// Landing page. Narrative composition of the Phase 6 sections.
//
// Layout summary:
//   * Hero, Problem, Before/After are full-width one after another.
//   * How it works + Chains:
//       < lg: two standalone sections stacked normally, each with its
//             own header + mobile auto-scroll.
//       >= lg: a single crossing showcase. How it works rolls to the
//             right on the top track, Chains rolls to the left on the
//             bottom track, with z-index layering so they literally
//             pass each other.
//   * Architecture + Live stats: paired on lg+. Architecture is a
//     slow right-scrolling marquee, Live stats stays static.
//   * System circuit: closing full-width animated blueprint.
//
// ScrollGuide pulls the user's eye toward the vault at the bottom.

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { useReducedMotion } from "framer-motion";
import { useWalletGate } from "@/lib/hooks/useWalletGate";
import { ConstellationBackground } from "@/components/layout/ConstellationBackground";
import { PreAlphaBanner } from "@/components/layout/PreAlphaBanner";
import { HeroSection } from "@/components/landing/HeroSection";
import { ProblemSection } from "@/components/landing/ProblemSection";
import { BeforeAfterSection } from "@/components/landing/BeforeAfterSection";
// import { HowItWorksSection } from "@/components/landing/HowItWorksSection";
import { ChainsGridSection } from "@/components/landing/ChainsGridSection";
import { HowItWorksChainsShowcase } from "@/components/landing/HowItWorksChainsShowcase";
import { ArchitectureSection } from "@/components/landing/ArchitectureSection";
import { LiveStatsSection } from "@/components/landing/LiveStatsSection";
import { SystemCircuitSection } from "@/components/landing/SystemCircuitSection";
import { VaultConnectSection } from "@/components/landing/VaultConnectSection";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { ScrollGuide } from "@/components/landing/ScrollGuide";

const BouncingRings = dynamic(
  () => import("@/components/landing/BouncingRings").then((m) => m.BouncingRings),
  { ssr: false }
);

const AnimatedBlob = dynamic(
  () => import("@/components/landing/AnimatedBlob").then((m) => m.AnimatedBlob),
  { ssr: false }
);

export default function HomePage() {
  useWalletGate();
  const reduce = useReducedMotion();

  // AnimatedBlob is a Three.js canvas that tracks the cursor — heavy on
  // mobile and pointless without a hover pointer. Gate it to md+.
  const [isMdUp, setIsMdUp] = useState(false);
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)");
    setIsMdUp(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setIsMdUp(e.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return (
    <main className="relative flex flex-col items-center overflow-x-clip bg-background font-sans">
      <ConstellationBackground />
      {!reduce && <BouncingRings />}
      {!reduce && isMdUp && <AnimatedBlob />}
      <ScrollGuide />

      <div className="relative z-10 mx-auto w-full max-w-[91rem] px-4 pt-28 sm:px-6 sm:pt-36 lg:px-8">
        <PreAlphaBanner />
      </div>

      <div className="relative z-10 mx-auto flex w-full max-w-[91rem] flex-col gap-[clamp(3rem,6vw,7rem)] px-4 pb-16 pt-8 sm:px-6 sm:pt-12 lg:px-8">
        <HeroSection />
        <ProblemSection />
        <BeforeAfterSection />

        {/* Mobile and tablet: standalone sections stacked normally. */}
        {/* <HowItWorksSection /> */}
        <ChainsGridSection />

        {/* Desktop: dual-header showcase with two opposing marquees. */}
        <HowItWorksChainsShowcase />

        {/* Architecture (marquee) + Live stats (static). Stacked on
            mobile, side by side on lg+. `grid-cols-1` is explicit so
            the browser does not auto-place the two sections into two
            implicit columns on narrow screens. */}
        <div className="grid grid-cols-1 gap-[clamp(2rem,3.5vw,3.5rem)] lg:grid-cols-2 lg:items-start">
          <ArchitectureSection />
          <LiveStatsSection />
        </div>

        <SystemCircuitSection />
      </div>

      <VaultConnectSection />
      <LandingFooter />
    </main>
  );
}
