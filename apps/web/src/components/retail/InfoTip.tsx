"use client";

// InfoTip - a small "i" badge that reveals supporting copy.
//
// Two render modes, picked by viewport:
//   - Desktop (sm+): inline popover anchored to the trigger,
//     opens on hover, focus, or click. Tucks neatly into dense
//     surfaces without taking layout space.
//   - Mobile (<640): full-width bottom sheet portaled to <body>
//     so it cannot be clipped by parent overflow / stacking
//     contexts. Slides up over a dimmed backdrop with a drag
//     handle, a close button, and body-scroll lock - matching the
//     other modal surfaces in the app (QrScanButton, WalletTour
//     Modal). Tap backdrop / Escape / close button to dismiss.
//
// Keyboard: focus on the trigger opens the desktop popover; on
// touch devices the trigger toggles the sheet.

import {
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useBodyScrollLock } from "@/lib/hooks/useBodyScrollLock";

interface InfoTipProps {
  /// Tooltip body. Plain string for short hints; ReactNode for
  /// label/value layouts or inline emphasis. On mobile this is
  /// rendered inside a bottom sheet so block-level children
  /// (paragraphs, lists) are fine.
  children: ReactNode;
  /// Screen-reader label for the trigger. Defaults to "More detail".
  label?: string;
  /// Title shown at the top of the mobile sheet. Falls back to
  /// `label` when omitted. Not shown on desktop.
  title?: string;
  /// Desktop popover width.  "sm" suits one-liners, "md" suits a
  /// few rows of label/value detail.
  width?: "sm" | "md";
  /// Desktop popover position relative to the trigger. Defaults to
  /// "bottom". Flip to "top" near a viewport edge.
  align?: "top" | "bottom";
  /// Horizontal anchor of the desktop popover against the trigger.
  /// Defaults to "center"; "end" right-aligns when the trigger sits
  /// near the right edge of its container.
  side?: "start" | "center" | "end";
  /// Icon size. Defaults to "sm".
  size?: "xs" | "sm";
  /// Optional class on the wrapping span.
  className?: string;
}

export function InfoTip({
  children,
  label = "More detail",
  title,
  width = "md",
  align = "bottom",
  side = "center",
  size = "sm",
  className,
}: InfoTipProps) {
  const reduce = useReducedMotion();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const wrapperRef = useRef<HTMLSpanElement | null>(null);

  // Track viewport size so we can pick render mode. matchMedia is
  // client-only; default to false on SSR so server output matches
  // the desktop popover branch (no portal in initial markup).
  useEffect(() => {
    setMounted(true);
    const mq = window.matchMedia("(max-width: 639px)");
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  // Lock background scroll while the mobile sheet is open. Desktop
  // popover doesn't need it - it's small and inline.
  useBodyScrollLock(open && isMobile);

  // Escape closes either mode.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Click-outside closes the desktop popover. The mobile sheet
  // handles dismissal via its backdrop.
  useEffect(() => {
    if (!open || isMobile) return;
    const onClickOutside = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, [open, isMobile]);

  const iconClass = size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5";
  const sheetTitle = title ?? label;

  const sideDesktop =
    side === "start"
      ? "left-0"
      : side === "end"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";
  const alignDesktop =
    align === "bottom" ? "top-full mt-2" : "bottom-full mb-2";
  const widthDesktop = width === "sm" ? "w-56" : "w-72";

  return (
    <>
      <span
        ref={wrapperRef}
        role="presentation"
        className={"relative inline-flex items-center " + (className ?? "")}
        // Hover behaviour only matters on desktop; on mobile the
        // touch-tap is the primary interaction and these handlers
        // are inert (no mouse events on a touch-only device).
        onMouseEnter={() => !isMobile && setOpen(true)}
        onMouseLeave={() => !isMobile && setOpen(false)}
      >
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }}
          onFocus={() => !isMobile && setOpen(true)}
          onBlur={() => !isMobile && setOpen(false)}
          className={
            "inline-flex h-5 w-5 items-center justify-center rounded-full text-text-soft " +
            "transition-colors duration-base ease-out-soft hover:text-text-strong " +
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-soft focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          }
        >
          <Info className={iconClass} strokeWidth={2} aria-hidden="true" />
        </button>

        {/* Desktop: inline popover anchored to the trigger. Hidden
            on mobile - the bottom sheet portal below handles that. */}
        <AnimatePresence>
          {open && !isMobile && (
            <motion.span
              id={id}
              role="tooltip"
              initial={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: align === "bottom" ? -4 : 4 }
              }
              animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={
                reduce
                  ? { opacity: 0 }
                  : { opacity: 0, y: align === "bottom" ? -4 : 4 }
              }
              transition={{
                duration: 0.16,
                ease: [0.22, 1, 0.36, 1] as const,
              }}
              className={
                "absolute z-30 block " +
                sideDesktop +
                " " +
                alignDesktop +
                " " +
                widthDesktop +
                " " +
                "rounded-card border border-border-soft bg-surface-raised p-3 text-left text-xs leading-relaxed text-text-soft shadow-card-rest"
              }
            >
              {children}
            </motion.span>
          )}
        </AnimatePresence>
      </span>

      {/* Mobile: bottom sheet rendered into <body> via portal so it
          escapes any clipping ancestor (overflow:hidden cards,
          sticky CTAs, transformed parents, etc). Mounted gate
          avoids document access during SSR. */}
      {mounted && isMobile &&
        createPortal(
          <AnimatePresence>
            {open && (
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={`${id}-title`}
                className="fixed inset-0 z-[200] flex items-end"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => setOpen(false)}
                  className="absolute inset-0 bg-text-strong/40 backdrop-blur-sm"
                  aria-hidden="true"
                />
                <motion.div
                  id={id}
                  initial={
                    reduce ? { opacity: 0 } : { y: "100%", opacity: 1 }
                  }
                  animate={reduce ? { opacity: 1 } : { y: 0 }}
                  exit={
                    reduce ? { opacity: 0 } : { y: "100%", opacity: 1 }
                  }
                  transition={{
                    duration: 0.32,
                    ease: [0.32, 0.72, 0, 1] as const,
                  }}
                  className={
                    "relative z-[201] w-full rounded-t-[1.5rem] border-t border-border-soft bg-surface-raised " +
                    "px-5 pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] pt-2 " +
                    "shadow-card-raised"
                  }
                >
                  {/* Drag handle - visual affordance that the sheet
                      is dismissible. Pure decoration; close happens
                      via the X button or backdrop tap. */}
                  <div
                    aria-hidden="true"
                    className="mx-auto h-1 w-10 rounded-full bg-border-soft"
                  />
                  <div className="mt-4 flex items-start justify-between gap-3">
                    <p
                      id={`${id}-title`}
                      className="font-display text-base font-semibold leading-snug text-text-strong"
                    >
                      {sheetTitle}
                    </p>
                    <button
                      type="button"
                      aria-label="Close"
                      onClick={() => setOpen(false)}
                      className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-soft transition-colors duration-base ease-out-soft hover:bg-canvas hover:text-text-strong"
                    >
                      <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-3 text-sm leading-relaxed text-text-soft">
                    {children}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
