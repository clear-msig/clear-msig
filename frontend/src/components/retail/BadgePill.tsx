"use client";

// BadgePill — small filled-accent action used inline next to chips
// and badges. Sits between the full Button primitive (≥36px tap
// target, used as a primary CTA) and a borderless inline link.
// Six call sites in the app shipped byte-identical 65-char inline
// strings; consolidating them here means a future visual change
// (e.g. retiring the accent color) is one diff.
//
// Renders as a <button> by default; pass `as="span"` when you need
// a non-interactive badge inside a parent that is itself clickable
// (e.g. a Link wrapping the row).

import { forwardRef, type ButtonHTMLAttributes } from "react";

type BadgePillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /// Slightly taller variant (py-1.5 vs py-1). Default "sm" matches
  /// the original 65-char string; "md" pulls the height closer to
  /// the Button primitive so it can replace one in tighter rows.
  size?: "sm" | "md";
};

export const BadgePill = forwardRef<HTMLButtonElement, BadgePillProps>(
  function BadgePill({ size = "sm", className, children, ...rest }, ref) {
    const sizeClasses =
      size === "sm" ? "px-3 py-1 text-[11px]" : "px-3 py-1.5 text-[11px]";
    return (
      <button
        ref={ref}
        type={rest.type ?? "button"}
        className={
          "inline-flex items-center gap-1 rounded-full bg-accent font-medium text-white shadow-accent-rest " +
          sizeClasses +
          " transition-[background-color,box-shadow,transform] duration-base ease-out-soft " +
          "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98] " +
          "disabled:cursor-not-allowed disabled:opacity-60 " +
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised " +
          (className ?? "")
        }
        {...rest}
      >
        {children}
      </button>
    );
  },
);
