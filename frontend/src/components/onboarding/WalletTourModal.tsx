"use client";

// Tier-6 onboarding tour. 3-step pop-in on the wallet detail page
// for users who haven't seen it. Hand-curated to highlight the
// least-discoverable affordances rather than walking through every
// button.
//
// State: a single localStorage flag ("clear.wallet-tour.seen.v1").
// Skip / finish both flip it. Power-users on a fresh device get
// re-prompted; we don't pretend the flag follows them across
// devices.

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

const SEEN_KEY = "clear.wallet-tour.seen.v1";

interface Step {
  title: string;
  body: string;
  /// Optional href for the "Try it" CTA. Omitted when the step is
  /// purely declarative.
  cta?: { label: string; href: string };
}

const STEPS: Step[] = [
  {
    title: "Send and receive money",
    body:
      "The Send pill in the hero starts a transfer. Receive opens a QR for someone to scan; the chains tab gives you the address per chain.",
  },
  {
    title: "Pending approvals show up everywhere",
    body:
      "Anything waiting on your sig surfaces on the dashboard, the bottom-nav Home badge, and (if you opt in) as a browser notification. You can also share a proposal link in your team's chat — the recipient lands on the approve page.",
  },
  {
    title: "Activity + audit trail",
    body:
      "Recent activity here shows this wallet only. The All-activity page in the dashboard aggregates every wallet you belong to and exports to CSV for accounting.",
    cta: { label: "Open all activity", href: "/app/activity" },
  },
];

export function WalletTourModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let seen = false;
    try {
      seen = window.localStorage.getItem(SEEN_KEY) === "1";
    } catch {
      seen = true; // localStorage blocked — don't loop the tour
    }
    if (!seen) {
      // Tiny delay so the underlying page is laid out before the
      // overlay arrives — matters more for reduced-motion users
      // who otherwise see content jump.
      const t = setTimeout(() => setOpen(true), 250);
      return () => clearTimeout(t);
    }
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  };

  // Standard modal expectation — Escape dismisses. The HeaderBar
  // drawer + CommandPalette already close on Escape; this was the
  // odd one out.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Freeze the page underneath. Tour overlays that don't scroll-
  // lock feel like phantom-touches on iOS where a tap that misses
  // the modal scrolls the wallet hub behind it.
  useBodyScrollLock(open);

  const advance = () => {
    if (step < STEPS.length - 1) setStep(step + 1);
    else dismiss();
  };

  const back = () => {
    if (step > 0) setStep(step - 1);
  };

  const current = STEPS[step];

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[250] bg-text-strong/40 backdrop-blur-sm"
            onClick={dismiss}
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-tour-title"
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="fixed left-1/2 top-1/2 z-[251] w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-raised"
          >
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-3 top-3 rounded-soft p-1 text-text-soft transition-colors hover:bg-canvas hover:text-text-strong"
              aria-label="Skip the tour"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
            </div>
            <p className="mt-4 text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Step {step + 1} of {STEPS.length}
            </p>
            <h2
              id="wallet-tour-title"
              className="mt-1 font-display text-display-xs leading-tight text-text-strong"
            >
              {current.title}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-text-soft">
              {current.body}
            </p>
            {current.cta && (
              <Link
                href={current.cta.href}
                onClick={dismiss}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
              >
                {current.cta.label} &rsaquo;
              </Link>
            )}
            <div className="mt-6 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={dismiss}
                className="text-[11px] text-text-soft hover:text-text-strong"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className={
                      "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft " +
                      "transition-colors duration-base ease-out-soft hover:border-accent hover:text-accent"
                    }
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={advance}
                  className={
                    "inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white " +
                    "transition-[background-color,transform] duration-base ease-out-soft " +
                    "hover:bg-accent-hover active:scale-[0.98]"
                  }
                >
                  {step === STEPS.length - 1 ? (
                    <>
                      <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
                      Done
                    </>
                  ) : (
                    <>
                      Next
                      <ArrowRight className="h-3 w-3" aria-hidden="true" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
