// Button — first primitive of the retail rebuild (locked 2026-04-30).
//
// Tokens consumed: `accent` family, `surface-raised`, `border-soft`,
// `text-strong`, `min-h-tap` / `min-h-tap-lg`, `rounded-soft`,
// `duration-base`, `ease-out-soft`. If you find yourself reaching for a
// raw hex or one-off shadow here, the design tokens are missing
// something — extend `tailwind.config.ts` rather than inlining values.

import { ButtonHTMLAttributes, forwardRef } from "react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const cn = (...inputs: Array<string | undefined | false>) =>
  twMerge(clsx(inputs));

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-accent-rest hover:bg-accent-hover hover:shadow-accent-hover",
  secondary:
    "bg-surface-raised text-text-strong border border-border-soft hover:border-border-strong",
  ghost: "bg-transparent text-text-strong hover:bg-surface-card/5",
  danger: "bg-danger text-white hover:bg-danger/90",
};

const sizes: Record<Size, string> = {
  sm: "min-h-[36px] px-3 text-sm",
  md: "min-h-tap px-5 text-base",
  lg: "min-h-tap-lg px-6 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  fullWidth?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", fullWidth, className, type, ...props },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type={type ?? "button"}
        className={cn(
          "inline-flex select-none items-center justify-center gap-2 rounded-soft font-sans font-medium",
          "transition-[background-color,box-shadow,transform,border-color,color] duration-base ease-out-soft",
          "active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          variants[variant],
          sizes[size],
          fullWidth && "w-full",
          className,
        )}
        {...props}
      />
    );
  },
);
