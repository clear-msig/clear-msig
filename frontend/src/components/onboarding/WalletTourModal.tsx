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
//
// Layout - three-region modal that always fits the viewport:
//   • Header  - close button + sparkles badge + step counter + title
//   • Body    - scrollable description + optional CTA. Scrolls when
//               the card would otherwise exceed `max-h-[calc(100dvh-6rem)]`,
//               so landscape phones / tiny viewports never clip
//               content off-screen.
//   • Footer  - sticky action bar (Skip · Back · Next) - always
//               reachable regardless of body length.

import { useEffect, useState } from "react";
import clsx from "clsx";
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
      "Anything waiting on your sig surfaces on the dashboard, the bottom-nav Home badge, and (if you opt in) as a browser notification. You can also share a proposal link in your team's chat - the recipient lands on the approve page.",
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
      seen = true; // localStorage blocked - don't loop the tour
    }
    if (!seen) {
      // Tiny delay so the underlying page is laid out before the
      // overlay arrives - matters more for reduced-motion users
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

  // Standard modal expectation - Escape dismisses. The HeaderBar
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
            // Three-region layout: sticky header + scrollable body +
            // sticky footer. max-h-[calc(100dvh-6rem)] reserves 3rem
            // top + 3rem bottom (covers the floating mobile header
            // pill / safe-area / BottomNav even on landscape phones).
            // overflow-hidden on the wrapper + flex-col with a
            // flex-1 overflow-y-auto body keeps the chrome regions
            // pinned while long copy scrolls inside.
            className={clsx(
              "fixed left-1/2 top-1/2 z-[251] -translate-x-1/2 -translate-y-1/2",
              "flex w-[min(calc(100vw-1.5rem),440px)] max-h-[calc(100dvh-6rem)] flex-col",
              "overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-raised",
            )}
          >
            {/* ── Header (sticky region) ────────────────────────── */}
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/30">
                  <Sparkles className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="flex flex-col gap-1">
                  {/* Progress dots - replaces the old "Step 1 of 3"
                      eyebrow. Active step renders as an elongated
                      accent pill so progress is glanceable. */}
                  <div
                    className="flex items-center gap-1"
                    role="progressbar"
                    aria-valuenow={step + 1}
                    aria-valuemin={1}
                    aria-valuemax={STEPS.length}
                    aria-label={`Step ${step + 1} of ${STEPS.length}`}
                  >
                    {STEPS.map((_, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={clsx(
                          "h-1.5 rounded-full transition-all duration-base ease-out-soft",
                          i === step
                            ? "w-6 bg-accent"
                            : i < step
                              ? "w-1.5 bg-accent/40"
                              : "w-1.5 bg-border-soft",
                        )}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
                    Quick tour
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Skip the tour"
                className={clsx(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-soft",
                  "transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-text-strong",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                )}
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            {/* ── Body (scrollable region) ──────────────────────── */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">
              <h2
                id="wallet-tour-title"
                className="font-display text-xl font-semibold leading-tight tracking-tight text-text-strong sm:text-2xl"
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
                  className="mt-4 inline-flex items-center gap-1 rounded-full border border-accent/30 bg-accent/[0.06] px-3 py-1 text-xs font-medium text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
                >
                  {current.cta.label}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              )}
            </div>

            {/* ── Footer (sticky region) ────────────────────────── */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border-soft px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={dismiss}
                className="rounded-soft px-2 py-1.5 text-xs font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className={clsx(
                      "rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft",
                      "transition-colors duration-base ease-out-soft hover:text-text-strong",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                    )}
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={advance}
                  className={clsx(
                    "inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-1.5 text-xs font-semibold text-text-on-accent shadow-accent-rest",
                    "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
                    "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                  )}
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
