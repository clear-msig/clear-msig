"use client";

// Terminal / persistent error state. For transient failures use
// <useToast />.error(...) . this component is meant for "the query
// failed and will stay failed until the user does something".

import { motion } from "framer-motion";
import { AlertTriangle, RefreshCw } from "lucide-react";
import clsx from "clsx";

interface Props {
  title: string;
  description?: string;
  onRetry?: () => void;
  /// Optional raw details (backend payload, stderr) . hidden behind a
  /// details/summary so it doesn't overwhelm the hero message.
  details?: string;
  tone?: "dark" | "light";
  className?: string;
}

export function ErrorState({
  title,
  description,
  onRetry,
  details,
  tone = "dark",
  className,
}: Props) {
  const isDark = tone === "dark";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      role="alert"
      aria-live="polite"
      className={clsx(
        "flex flex-col gap-3 rounded-2xl border p-5",
        isDark
          ? "border-rose-500/30 bg-rose-500/[0.06]"
          : "border-rose-500/30 bg-rose-50",
        className
      )}
    >
      <div className="flex items-start gap-3">
        <span
          className={clsx(
            "rounded-lg p-2",
            isDark ? "bg-rose-500/20 text-rose-300" : "bg-rose-500/15 text-rose-600"
          )}
        >
          <AlertTriangle size={16} />
        </span>
        <div className="flex-1">
          <h3
            className={clsx(
              "font-display text-sm font-semibold",
              isDark ? "text-rose-50" : "text-rose-900"
            )}
          >
            {title}
          </h3>
          {description && (
            <p
              className={clsx(
                "mt-1 text-sm",
                isDark ? "text-rose-100/80" : "text-rose-800/80"
              )}
            >
              {description}
            </p>
          )}
        </div>
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-colors",
              isDark
                ? "bg-rose-500/15 text-rose-100 hover:bg-rose-500/25"
                : "bg-rose-500 text-white hover:bg-rose-600"
            )}
          >
            <RefreshCw size={12} /> Retry
          </button>
        )}
      </div>
      {details && (
        <details
          className={clsx(
            "rounded-lg px-3 py-2 text-[11px]",
            isDark ? "bg-surface-card/30 text-rose-100/70" : "bg-white text-rose-900/70"
          )}
        >
          <summary className="cursor-pointer font-medium">Details</summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono leading-snug">
            {details}
          </pre>
        </details>
      )}
    </motion.div>
  );
}
