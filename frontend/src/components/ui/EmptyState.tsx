"use client";

// Empty state . illustration (icon) + one-line copy + optional CTA.
//
// Meant for "no data yet" branches across the app. Keep copy
// outcome-focused ("No multisigs yet . create one →") rather than
// failure-focused ("No data").

import Link from "next/link";
import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import { Sparkles } from "lucide-react";
import clsx from "clsx";

interface Props {
  title: string;
  description?: string;
  icon?: LucideIcon;
  tone?: "dark" | "light";
  action?:
    | { label: string; href: string; external?: boolean }
    | { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({
  title,
  description,
  icon: Icon = Sparkles,
  tone = "dark",
  action,
  className,
}: Props) {
  const isDark = tone === "dark";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      role="status"
      className={clsx(
        "flex flex-col items-center gap-3 rounded-2xl border border-dashed p-8 text-center",
        isDark ? "border-white/10 bg-white/[0.02]" : "border-black/10 bg-white/60",
        className
      )}
    >
      <div
        className={clsx(
          "flex h-12 w-12 items-center justify-center rounded-full",
          isDark ? "bg-brand-green/10 text-brand-green" : "bg-brand-green/15 text-brand-green"
        )}
      >
        <Icon size={20} />
      </div>
      <h3
        className={clsx(
          "font-display text-base font-semibold tracking-tight sm:text-lg",
          isDark ? "text-brand-white" : "text-text-strong"
        )}
      >
        {title}
      </h3>
      {description && (
        <p
          className={clsx(
            "max-w-md text-sm",
            isDark ? "text-text-card-muted" : "text-text-muted"
          )}
        >
          {description}
        </p>
      )}
      {action && <EmptyStateAction action={action} />}
    </motion.div>
  );
}

function EmptyStateAction({ action }: { action: NonNullable<Props["action"]> }) {
  const baseClass =
    "inline-flex items-center gap-1.5 rounded-full bg-brand-green/15 px-4 py-2 text-xs font-semibold text-brand-green transition-colors hover:bg-brand-green/25 focus-visible:outline-brand-green";
  if ("href" in action) {
    if (action.external) {
      return (
        <a
          href={action.href}
          target="_blank"
          rel="noreferrer"
          className={baseClass}
        >
          {action.label} →
        </a>
      );
    }
    return (
      <Link href={action.href} className={baseClass}>
        {action.label} →
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={baseClass}>
      {action.label}
    </button>
  );
}
