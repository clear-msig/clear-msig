"use client";

// Auto-scrolling horizontal carousel.
//
// Renders children twice in a row and translates the whole row between
// 0 and -50% on a loop, so the viewer sees an endless stream of cards
// without any measurement work at runtime. Pointer interaction pauses
// the loop so users can dwell on a specific card, then releasing
// resumes it.
//
// Direction:
//   * "left"  cards glide from right to left (standard ticker).
//   * "right" cards glide from left to right (CSS animation-direction
//             reverse on the same keyframes).
//
// Respects `prefers-reduced-motion` by stopping the animation and
// allowing native horizontal scrolling instead.

import { useEffect, useState, type ReactNode } from "react";
import clsx from "clsx";

interface Props {
  children: ReactNode;
  /// Seconds for one full cycle of the non-duplicated content.
  durationSec?: number;
  /// Outer wrapper class. Usually a visibility class like "md:hidden".
  className?: string;
  /// Tailwind gap class between items.
  gapClass?: string;
  /// Width class applied to each item wrapper. Use clamp() to keep
  /// cards proportional to the viewport.
  itemClass?: string;
  /// Which direction the cards appear to travel.
  direction?: "left" | "right";
  /// Tint the edge fades so the scroller blends into a dark parent
  /// when needed. Defaults to the page background.
  fadeFrom?: "background" | "black" | "none";
}

export function AutoHScroller({
  children,
  durationSec = 32,
  className,
  gapClass = "gap-3 sm:gap-4",
  itemClass = "w-[clamp(150px,48vw,220px)]",
  direction = "left",
  fadeFrom = "background",
}: Props) {
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const items = Array.isArray(children) ? children : [children];
  const doubled = [...items, ...items];

  const fadeClassLeft =
    fadeFrom === "black"
      ? "bg-gradient-to-r from-black to-transparent"
      : fadeFrom === "background"
      ? "bg-gradient-to-r from-background to-transparent"
      : "";
  const fadeClassRight =
    fadeFrom === "black"
      ? "bg-gradient-to-l from-black to-transparent"
      : fadeFrom === "background"
      ? "bg-gradient-to-l from-background to-transparent"
      : "";

  return (
    <div
      className={clsx("relative overflow-hidden", className)}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onPointerDown={() => setPaused(true)}
      onPointerUp={() => setPaused(false)}
      onPointerCancel={() => setPaused(false)}
    >
      {fadeFrom !== "none" && (
        <>
          <div
            aria-hidden="true"
            className={clsx(
              "pointer-events-none absolute left-0 top-0 z-10 h-full w-6 sm:w-10",
              fadeClassLeft
            )}
          />
          <div
            aria-hidden="true"
            className={clsx(
              "pointer-events-none absolute right-0 top-0 z-10 h-full w-6 sm:w-10",
              fadeClassRight
            )}
          />
        </>
      )}

      <div
        className={clsx(
          "hide-scroll flex w-max py-2",
          gapClass,
          reducedMotion
            ? "overflow-x-auto snap-x snap-mandatory"
            : "animate-auto-scroll"
        )}
        style={
          reducedMotion
            ? undefined
            : {
                ["--scroll-duration" as string]: `${durationSec}s`,
                animationPlayState: paused ? "paused" : "running",
                animationDirection: direction === "right" ? "reverse" : "normal",
              }
        }
      >
        {doubled.map((child, i) => (
          <div
            key={i}
            className={clsx("shrink-0 snap-center", itemClass)}
          >
            {child}
          </div>
        ))}
      </div>
    </div>
  );
}
