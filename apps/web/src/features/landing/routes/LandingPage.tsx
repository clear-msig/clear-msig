"use client";

import { LandingNav } from "@/components/landing/LandingChrome";
import { LandingBackToTop } from "@/components/landing/LandingScrollUI";
import { LandingReveal } from "@/components/landing/LandingReveal";
import { SecureSection } from "@/components/landing/SecureSection";
import { AgentControlSection } from "@/features/landing/ui/home/AgentControlSection";
import { Bento } from "@/features/landing/ui/home/Bento";
import { ChainMarquee } from "@/features/landing/ui/home/ChainMarquee";
import { Footer } from "@/features/landing/ui/home/Footer";
import { Hero } from "@/features/landing/ui/home/Hero";
import { WhyClear } from "@/features/landing/ui/home/WhyClear";

export default function HomePage() {
  return (
    <div className="landing-shell min-h-screen bg-canvas text-text-strong">
      <a href="#landing-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-soft focus:bg-accent focus:px-4 focus:py-3 focus:text-text-on-accent">Skip to content</a>
      <LandingBackToTop />
      <LandingNav />
      <main id="landing-content" tabIndex={-1} className="mx-auto w-full max-w-[1280px]">
        <Hero />
        <LandingReveal><ChainMarquee /></LandingReveal>
        <LandingReveal><Bento /></LandingReveal>
        <LandingReveal><WhyClear /></LandingReveal>
        <LandingReveal><AgentControlSection /></LandingReveal>
        <LandingReveal><SecureSection /></LandingReveal>
        <LandingReveal><Footer /></LandingReveal>
      </main>
    </div>
  );
}
