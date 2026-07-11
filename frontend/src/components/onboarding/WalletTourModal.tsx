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

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, Sparkles, X } from "lucide-react";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";
import { useFocusTrap } from "@/lib/hooks/useFocusTrap";

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
      "Send starts a transfer. Receive opens a QR for someone to scan. Extra networks live in Advanced settings.",
  },
  {
    title: "Pending approvals show up everywhere",
    body:
      "Anything waiting for your approval appears on the dashboard, the Home badge, and optional browser notifications. You can also share a request link in your team's chat; the recipient lands on the approve page.",
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  useFocusTrap(dialogRef, open);

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

  const dismiss = useCallback(() => {
    setOpen(false);
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }, []);

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
  }, [dismiss, open]);

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
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-0 z-[250] bg-text-strong/40 backdrop-blur-sm"
            onClick={dismiss}
            aria-hidden="true"
          />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="wallet-tour-title"
            tabIndex={-1}
            initial={reduce ? false : { opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            // Three-region layout: sticky header + scrollable body +
            // sticky footer. overflow-hidden on the wrapper +
            // flex-col with a flex-1 overflow-y-auto body keeps the
            // chrome regions pinned while long copy scrolls inside.
            //
            // Positioning differs by viewport so the modal is always
            // fully visible:
            //  - Mobile: top-anchored below the floating HeaderBar
            //    pill (safe-area-top + ~4rem clearance), full width
            //    minus a small gutter, max-height capped to leave
            //    room for BottomNav + safe-area-bottom + breathing.
            //    Centering vertically on a small phone could push
            //    the modal off-screen when content is taller than
            //    the gap; anchoring to the top guarantees it never
            //    does.
            //  - Desktop: centered horizontally + vertically with a
            //    fixed 440px width.
            className={clsx(
              "fixed z-[251] flex flex-col overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-raised",
              // Mobile - top-anchored, full-width with gutter
              "inset-x-3 top-[calc(env(safe-area-inset-top,0px)+4rem)]",
              "max-h-[calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-9rem)]",
              // Desktop - centered, fixed width, generous max-height
              "sm:inset-x-auto sm:left-1/2 sm:top-1/2 sm:w-[440px] sm:-translate-x-1/2 sm:-translate-y-1/2",
              "sm:max-h-[calc(100dvh-6rem)]",
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
                  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-text-soft",
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
                tabIndex={-1}
                data-dialog-initial-focus
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
                  className="mt-4 inline-flex min-h-tap items-center gap-1 rounded-full border border-accent/30 bg-accent/[0.06] px-3 py-2 text-xs font-medium text-accent transition-colors duration-base ease-out-soft hover:bg-accent/15"
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
                className="min-h-tap rounded-soft px-3 py-2 text-xs font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Skip
              </button>
              <div className="flex items-center gap-2">
                {step > 0 && (
                  <button
                    type="button"
                    onClick={back}
                    className={clsx(
                      "min-h-tap rounded-full border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-soft",
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
                    "inline-flex min-h-tap items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-semibold text-text-on-accent shadow-accent-rest",
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
