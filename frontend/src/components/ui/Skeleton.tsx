"use client";

// Skeleton shimmer . dimensions match the final content so layouts
// don't jank when data arrives. Cheap, zero-JS animation (pure CSS).
//
// Usage:
//   <Skeleton className="h-6 w-40" />        // single line
//   <SkeletonBlock rows={3} />              // multi-line paragraph
//   <SkeletonCard />                        // card-shaped placeholder

import { motion } from "framer-motion";
import clsx from "clsx";

interface SkeletonProps {
  className?: string;
  /// Tone used when rendering on a dark (black) surface. Defaults to
  /// the light-background variant.
  tone?: "light" | "dark";
}

export function Skeleton({ className, tone = "light" }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-block animate-pulse rounded-md",
        tone === "dark" ? "bg-white/5" : "bg-surface-card/5",
        className
      )}
    />
  );
}

export function SkeletonBlock({
  rows = 3,
  tone = "light",
  className,
}: {
  rows?: number;
  tone?: "light" | "dark";
  className?: string;
}) {
  const widths = ["w-full", "w-11/12", "w-10/12", "w-9/12", "w-8/12"];
  return (
    <div
      role="status"
      aria-label="Loading content"
      className={clsx("flex flex-col gap-2", className)}
    >
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} tone={tone} className={clsx("h-4", widths[i % widths.length])} />
      ))}
    </div>
  );
}

export function SkeletonCard({
  tone = "light",
  className,
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      role="status"
      aria-label="Loading"
      className={clsx(
        "flex flex-col gap-3 rounded-2xl border p-4",
        tone === "dark"
          ? "border-white/10 bg-white/[0.02]"
          : "border-black/10 bg-white/70",
        className
      )}
    >
      <Skeleton tone={tone} className="h-5 w-1/3" />
      <SkeletonBlock rows={3} tone={tone} />
    </motion.div>
  );
}
