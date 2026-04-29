"use client";

// First-visit walkthrough. Three slides explaining Clear-MSIG, ending in
// a Connect Wallet CTA. Once dismissed (Skip or Get started), the modal
// never shows again unless re-triggered from the menu.
//
// Transitions are pure transform + opacity so they stay GPU-accelerated
// at 60fps even on mid-tier mobile.

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, X } from "lucide-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useWallet } from "@solana/wallet-adapter-react";
import { useOnboarding } from "@/lib/hooks/useOnboarding";

interface Slide {
  eyebrow: string;
  title: string;
  body: string;
}

const SLIDES: Slide[] = [
  {
    eyebrow: "What it is",
    title: "Sign intents, not hex.",
    body: "Clear-MSIG turns multisig signatures into human-readable sentences. Your Ledger shows exactly what you're approving — never an opaque blob of bytes.",
  },
  {
    eyebrow: "How it works",
    title: "One policy. Every chain.",
    body: "The same Solana multisig drives native transactions on Ethereum, Bitcoin, and Zcash via Ika dWallet 2PC-MPC. No bridges, no wrappers.",
  },
  {
    eyebrow: "Get started",
    title: "Connect to take it for a spin.",
    body: "Connect any Solana wallet (Phantom, Solflare, Ledger). Devnet only — pre-alpha. No real funds at risk.",
  },
];

export function OnboardingWalkthrough() {
  const { hydrated, completed, complete } = useOnboarding();
  const { connected } = useWallet();
  const [step, setStep] = useState(0);

  // Auto-dismiss the moment a wallet connects, regardless of how the user
  // got to the wallet-selector — they could have clicked Connect on the
  // last slide, or skipped to the homepage and connected from the header.
  // Either way, the walkthrough has served its purpose; keep going.
  useEffect(() => {
    if (connected && !completed) complete();
  }, [connected, completed, complete]);

  // Escape = same as Skip. Standard modal expectation.
  useEffect(() => {
    if (!hydrated || completed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") complete();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hydrated, completed, complete]);

  if (!hydrated || completed) return null;

  const isLast = step === SLIDES.length - 1;
  const slide = SLIDES[step];

  const next = () => setStep((s) => Math.min(s + 1, SLIDES.length - 1));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/85 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.96 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
        className="relative mx-4 w-full max-w-md overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        {/* Skip - top right. Dismisses the walkthrough; the landing page
            then shows the Connect Wallet button in the header. */}
        <button
          onClick={complete}
          className="absolute right-4 top-4 z-10 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-black/40 transition-colors hover:bg-black/5 hover:text-black/80"
          aria-label="Skip walkthrough and go to connect wallet"
        >
          Skip <X size={12} />
        </button>

        <div className="px-7 pb-7 pt-12 sm:px-9 sm:pb-9 sm:pt-14">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-green/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-brand-emerald">
                {slide.eyebrow}
              </span>
              <h2
                id="onboarding-title"
                className="mt-4 font-display text-2xl font-bold leading-tight tracking-tight text-black sm:text-3xl"
              >
                {slide.title}
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-black/65 sm:text-base">
                {slide.body}
              </p>
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 flex items-center justify-between gap-4">
            {/* progress dots */}
            <div className="flex items-center gap-1.5" role="tablist" aria-label="walkthrough progress">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === step}
                  aria-label={`Step ${i + 1} of ${SLIDES.length}`}
                  onClick={() => setStep(i)}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === step ? "w-7 bg-black" : "w-1.5 bg-black/15 hover:bg-black/30"
                  }`}
                />
              ))}
            </div>

            {isLast ? (
              <WalletMultiButton
                className="!h-auto !rounded-full !bg-black !px-5 !py-2.5 !text-sm !font-semibold !text-white hover:!bg-black/85"
              />
            ) : (
              <button
                type="button"
                onClick={next}
                className="inline-flex items-center gap-1.5 rounded-full bg-black px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-150 hover:scale-[1.02] active:scale-[0.98]"
              >
                Next <ArrowRight size={14} />
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
