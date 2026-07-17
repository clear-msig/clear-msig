"use client";

// Brand-styled dropdown - replacement for native <select> on dark
// surfaces. Matches the activity-page filter dropdown so every
// select control across the app reads with the same chrome:
//   • chip-style trigger with chevron that rotates 180° when open
//   • menu surface = bg-surface-raised + shadow-card-raised
//   • selected option = accent text + check glyph
//   • highlighted option = subtle white tint
//   • full keyboard nav (↑/↓ Home/End Enter Esc Tab)
//   • click-outside + Esc closes
//
// Used as a standalone control (no "Label:" prefix). For
// filter-style usage with a label prefix, wrap this in a label
// element or a small chip.

import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";

export interface BrandSelectOption {
  value: string;
  label: string;
  /// Optional secondary line shown below the label in the menu (e.g.
  /// derivation path under "Account 0"). Doesn't render in the trigger.
  description?: string;
}

interface Props {
  options: BrandSelectOption[];
  value: string;
  onChange: (v: string) => void;
  /// Aria-label for the trigger button. Required for accessibility
  /// when no surrounding label provides context.
  ariaLabel: string;
  /// Optional placeholder when value doesn't match any option (rare).
  placeholder?: string;
  className?: string;
  /// Maximum menu height before scrolling. Defaults to ~14rem.
  maxMenuHeight?: string;
}

export function BrandSelect({
  options,
  value,
  onChange,
  ariaLabel,
  placeholder = "Select…",
  className,
  maxMenuHeight = "14rem",
}: Props) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = options.find((o) => o.value === value);

  // Close on outside click + Esc.
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (
        !triggerRef.current?.contains(e.target as Node) &&
        !menuRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setHighlight(-1);
      return;
    }
    const i = options.findIndex((o) => o.value === value);
    setHighlight(i >= 0 ? i : 0);
  }, [open, options, value]);

  useEffect(() => {
    if (!open || highlight < 0) return;
    optionRefs.current[highlight]?.focus({ preventScroll: false });
  }, [open, highlight]);

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    }
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(options.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(0, h - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setHighlight(options.length - 1);
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className={clsx("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className={clsx(
          "inline-flex items-center justify-between gap-2 rounded-soft border bg-canvas px-3 py-2 text-xs font-medium",
          "transition-colors duration-base ease-out-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
          open
            ? "border-accent/40 text-text-strong"
            : "border-border-soft text-text-strong hover:border-border-strong",
        )}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className={clsx(
            "shrink-0 transition-transform duration-base ease-out-soft",
            open ? "rotate-180 text-text-strong" : "text-text-soft",
          )}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            role="listbox"
            aria-label={ariaLabel}
            tabIndex={-1}
            onKeyDown={onMenuKeyDown}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
            style={{ maxHeight: maxMenuHeight }}
            className={clsx(
              "absolute left-0 top-[calc(100%+6px)] z-50 min-w-full max-w-[20rem]",
              "overflow-y-auto overflow-x-hidden",
              "rounded-card border border-border-soft bg-surface-raised py-1 shadow-card-raised",
            )}
          >
            {options.map((o, i) => {
              const isSelected = o.value === value;
              const isHighlighted = i === highlight;
              return (
                <button
                  key={o.value}
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(o.value);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  onMouseEnter={() => setHighlight(i)}
                  className={clsx(
                    "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs",
                    "transition-colors duration-base ease-out-soft focus:outline-none",
                    isSelected ? "font-medium text-accent" : "text-text-strong",
                    isHighlighted &&
                      (isSelected ? "bg-accent/10" : "bg-glass-soft"),
                  )}
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate">{o.label}</span>
                    {o.description ? (
                      <span className="mt-0.5 truncate font-mono text-[10px] text-text-soft">
                        {o.description}
                      </span>
                    ) : null}
                  </span>
                  {isSelected ? (
                    <Check
                      size={12}
                      strokeWidth={2.5}
                      className="shrink-0"
                      aria-hidden="true"
                    />
                  ) : null}
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
