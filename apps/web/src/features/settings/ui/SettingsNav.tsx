"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";

const NAV_SECTIONS: { id: string; label: string }[] = [
  { id: "privacy", label: "Privacy" },
  { id: "display", label: "Display" },
  { id: "notifications", label: "Notifications" },
  { id: "advanced", label: "Advanced" },
  { id: "about", label: "About" },
];

export function SettingsNav() {
  const [activeId, setActiveId] = useState<string>("");

  // Watch each Group section. As the user scrolls, whichever
  // section is intersecting the top-third strip wins. The negative
  // bottom rootMargin shrinks the active zone to just the top of
  // the viewport so we don't flicker between two visible sections.
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        // Pick the first section in the canonical order that's
        // currently in the active zone - gives stable upward
        // progression as the user scrolls.
        const ordered = NAV_SECTIONS.map((s) => s.id);
        const next = ordered.find((id) => visible.has(id));
        if (next) setActiveId(next);
      },
      {
        rootMargin: "-72px 0px -55% 0px",
        threshold: 0,
      },
    );
    NAV_SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      aria-label="Settings sections"
      className={clsx(
        // top-16 on mobile clears the fixed mobile-backdrop (h-16)
        // that sits above the body scroll, so the nav sticks directly
        // below the floating header pill. Desktop has no backdrop -
        // the parent scroll container starts directly below the
        // DashboardHeader, so md:top-0 sticks the nav flush against
        // the header bottom (no gap, no double-line).
        "sticky top-16 z-10 -mx-3 md:top-0 sm:-mx-4 md:-mx-8 lg:-mx-10 xl:-mx-12",
        "border-b border-border-soft bg-canvas",
        // Soft downward shadow gives the nav a stronger "stuck" cue
        // on mobile (the pill above + the nav below need to read as
        // distinct chrome layers, not one merged blur).
        "shadow-[0_6px_16px_-8px_rgba(0,0,0,0.5)]",
      )}
    >
      <div
        className={clsx(
          "flex items-center gap-1.5 overflow-x-auto px-3 py-2.5 sm:px-4 md:px-8 lg:px-10 xl:px-12",
          // Hide the scrollbar visually - the horizontal scroll is
          // there as a fallback for narrow viewports, but a permanent
          // scrollbar reads as clutter inside what's effectively chrome.
          "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden",
        )}
      >
        {NAV_SECTIONS.map((s) => {
          const active = activeId === s.id;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active ? "location" : undefined}
              className={clsx(
                "inline-flex min-h-11 shrink-0 items-center rounded-full px-3 py-1.5 text-xs font-medium",
                "transition-colors duration-base ease-out-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                active
                  ? "bg-accent/10 text-accent"
                  : "text-text-soft hover:bg-glass-soft hover:text-text-strong",
              )}
            >
              {s.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
