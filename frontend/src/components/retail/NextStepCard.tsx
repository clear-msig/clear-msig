"use client";

// Post-action "what next" picker.
//
// Used on every success state (enable-sending done, send delivered,
// friend added, etc.) so the user gets an explicit choose-your-own
// rather than being silently routed somewhere. Reads the user's
// likely next moves out loud:
//
//   <NextStepCard
//     title="Sending is on. What's next?"
//     options={[
//       { label: "Send your first request", href: "/app/wallet/<name>/send", primary: true },
//       { label: "Invite someone",        href: "/.../members/add" },
//       { label: "Back to wallet",        href: "/.../" },
//     ]}
//   />
//
// Pattern: one primary (accent-coloured CTA), zero or more secondaries
// (ghost), and an optional "Back" escape hatch. Mirrors the explicit
// inform-and-choose pattern we replaced silent /setup auto-redirects
// with — the same idea, applied at the *end* of an action instead of
// the start.

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export interface NextStepOption {
  /// Visible label.
  label: string;
  /// Where the link goes. Mutually exclusive with `onClick` —
  /// callers either route the user away (href) or stay on the
  /// page and run a local action (onClick), never both.
  href?: string;
  onClick?: () => void;
  /// One short clarifier rendered under the label.
  hint?: string;
  /// Render as the primary accent button. At most one per card.
  primary?: boolean;
  /// Optional left-side icon for visual scanning.
  icon?: LucideIcon;
}

interface NextStepCardProps {
  title: string;
  /// Optional one-line subtitle below the title.
  subtitle?: string;
  options: NextStepOption[];
}

export function NextStepCard({
  title,
  subtitle,
  options,
}: NextStepCardProps) {
  return (
    <section
      aria-label="What's next"
      className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest"
    >
      <span aria-hidden="true" className="block h-px w-10 bg-accent" />
      <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        What&rsquo;s next
      </p>
      <h3 className="mt-2 font-display text-base font-semibold text-text-strong">
        {title}
      </h3>
      {subtitle && (
        <p className="mt-1 text-sm text-text-soft">{subtitle}</p>
      )}
      <ul className="mt-4 flex flex-col gap-2">
        {options.map((opt) => (
          <li key={opt.href + opt.label}>
            <NextStepLink {...opt} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function NextStepLink({
  label,
  href,
  onClick,
  hint,
  primary,
  icon: Icon,
}: NextStepOption) {
  const base =
    "group flex w-full items-center gap-3 rounded-card px-4 py-3 text-left transition-[border-color,background-color,transform,box-shadow] duration-base ease-out-soft " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised";
  const variant = primary
    ? "border border-accent/40 bg-accent/[0.06] text-text-strong shadow-card-rest hover:-translate-y-0.5 hover:border-accent hover:shadow-card-raised"
    : "border border-border-soft bg-canvas text-text-strong hover:border-accent/40 hover:bg-surface-raised";
  const inner = (
    <>
      {Icon && (
        <span
          className={
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-full " +
            (primary
              ? "bg-accent text-white"
              : "bg-accent/10 text-accent")
          }
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" strokeWidth={2} />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        {hint && (
          <span className="mt-0.5 text-xs text-text-soft">{hint}</span>
        )}
      </span>
      <ArrowRight
        className={
          "h-4 w-4 shrink-0 transition-transform duration-base group-hover:translate-x-0.5 " +
          (primary ? "text-accent" : "text-text-soft group-hover:text-accent")
        }
        aria-hidden="true"
      />
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base + " " + variant}>
        {inner}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className={base + " " + variant}>
      {inner}
    </Link>
  );
}
