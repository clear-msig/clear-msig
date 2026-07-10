"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown, type LucideIcon } from "lucide-react";

export function ActionGroup({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.26em] text-text-soft">
          {label}
        </h3>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-text-soft/80">
            {description}
          </p>
        ) : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function ActionRow({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  body?: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group relative flex min-h-[64px] items-center gap-3 overflow-hidden rounded-card border border-border-soft bg-surface-raised px-4 py-3 shadow-card-rest " +
        "transition-[transform,border-color,box-shadow,background-color] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/35 hover:bg-canvas hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent opacity-0 transition-opacity duration-base group-hover:opacity-100"
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-colors duration-base group-hover:bg-accent/15">
        <Icon className="h-4 w-4" strokeWidth={1.85} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-strong">
          {title}
        </p>
        {body ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-text-soft">
            {body}
          </p>
        ) : null}
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas/70 text-text-soft transition-[color,transform] duration-base group-hover:translate-x-0.5 group-hover:text-accent">
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}

export function ActionButton({
  icon: Icon,
  title,
  body,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  body?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "group relative flex min-h-[64px] items-center gap-3 overflow-hidden rounded-card border border-border-soft bg-surface-raised px-4 py-3 text-left shadow-card-rest " +
        "transition-[transform,border-color,box-shadow,background-color] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:border-accent/35 hover:bg-canvas hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 bottom-0 h-px bg-gradient-to-r from-transparent via-accent/35 to-transparent opacity-0 transition-opacity duration-base group-hover:opacity-100"
      />
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent transition-colors duration-base group-hover:bg-accent/15">
        <Icon className="h-4 w-4" strokeWidth={1.85} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-strong">
          {title}
        </p>
        {body ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-text-soft">
            {body}
          </p>
        ) : null}
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas/70 text-text-soft transition-[color,transform] duration-base group-hover:translate-x-0.5 group-hover:text-accent">
        <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </button>
  );
}
