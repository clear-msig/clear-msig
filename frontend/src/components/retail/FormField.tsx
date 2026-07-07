"use client";

import {
  forwardRef,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import clsx from "clsx";
import { twMerge } from "tailwind-merge";
import { ChevronDown } from "lucide-react";

const cn = (...inputs: Array<string | undefined | false>) =>
  twMerge(clsx(inputs));

const fieldFrame =
  "w-full rounded-soft border border-border-soft bg-canvas text-sm text-text-strong shadow-none outline-none";
const fieldMotion =
  "transition-[border-color,box-shadow,background-color,color] duration-base ease-out-soft";
const fieldFocus =
  "focus:border-accent focus:ring-2 focus:ring-accent/20 focus-visible:outline-none";
const fieldDisabled =
  "disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-softer disabled:opacity-70";
const fieldPlaceholder = "placeholder:text-text-softer";

export const FIELD_CLASS = cn(
  fieldFrame,
  fieldMotion,
  fieldFocus,
  fieldDisabled,
  fieldPlaceholder,
  "min-h-tap px-3 py-2.5",
);

export const TEXTAREA_CLASS = cn(
  fieldFrame,
  fieldMotion,
  fieldFocus,
  fieldDisabled,
  fieldPlaceholder,
  "min-h-[96px] resize-none px-3 py-2.5 leading-relaxed",
);

export function FormField({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span className="text-xs font-medium text-text-soft">{label}</span>
      {children}
      {error ? (
        <span className="text-xs leading-relaxed text-danger">{error}</span>
      ) : hint ? (
        <span className="text-xs leading-relaxed text-text-soft">{hint}</span>
      ) : null}
    </label>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          FIELD_CLASS,
          invalid && "border-danger/60 focus:border-danger focus:ring-danger/20",
          className,
        )}
        {...props}
      />
    );
  },
);

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ className, invalid, rows = 4, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={cn(
          TEXTAREA_CLASS,
          invalid && "border-danger/60 focus:border-danger focus:ring-danger/20",
          className,
        )}
        {...props}
      />
    );
  },
);

export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, invalid, children, ...props }, ref) {
    return (
      <span className="relative block min-w-0">
        <select
          ref={ref}
          className={cn(
            FIELD_CLASS,
            "appearance-none pr-9",
            invalid && "border-danger/60 focus:border-danger focus:ring-danger/20",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-soft"
          aria-hidden="true"
        />
      </span>
    );
  },
);
