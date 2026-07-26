import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

export function HourPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (h: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-card bg-canvas px-3 py-2">
      <span className="text-xs font-medium uppercase tracking-[0.16em] text-text-soft">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className={
          "rounded-soft bg-transparent px-2 py-1 text-sm font-medium text-text-strong outline-none " +
          "transition-[border-color] duration-base ease-out-soft " +
          "focus:border-accent"
        }
      >
        {Array.from({ length: 24 }, (_, h) => h).map((h) => (
          <option key={h} value={h}>
            {formatHourOption(h)}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatHourOption(h: number): string {
  if (h === 0) return "12 am (midnight)";
  if (h === 12) return "12 pm (noon)";
  if (h < 12) return `${h} am`;
  return `${h - 12} pm`;
}

// Shared bits

export function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        "rounded-full px-3 py-1.5 transition-[background-color,color] duration-base ease-out-soft " +
        (active
          ? "bg-accent text-text-on-accent"
          : "text-text-soft hover:text-text-strong") +
        " focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
      }
    >
      {children}
    </button>
  );
}

export function NavCard({
  href,
  icon: Icon,
  title,
  body,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  body: string;
}) {
  return (
    <Link
      href={href}
      className={
        "group flex items-start gap-3 rounded-card bg-surface-raised p-4 shadow-card-rest sm:p-5 " +
        "transition-[transform,background-color,box-shadow] duration-base ease-out-soft " +
        "hover:-translate-y-0.5 hover:bg-canvas hover:shadow-card-raised " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      }
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent">
        <Icon className="h-5 w-5" strokeWidth={1.75} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-strong">{title}</p>
        <p className="mt-0.5 text-xs text-text-soft">{body}</p>
      </div>
      <ArrowRight
        className="mt-1 h-4 w-4 shrink-0 text-text-soft transition-transform duration-base group-hover:translate-x-0.5 group-hover:text-accent"
        aria-hidden="true"
      />
    </Link>
  );
}
