"use client";

import {
  createContext,
  forwardRef,
  useContext,
  useId,
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

const FieldContext = createContext<{ labelId: string; descriptionId?: string; invalid: boolean } | null>(null);

function useFieldAccessibility(invalid: boolean | undefined, props: {
  "aria-invalid"?: InputHTMLAttributes<HTMLInputElement>["aria-invalid"];
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-describedby"?: string;
}) {
  const field = useContext(FieldContext);
  return {
    "aria-invalid": props["aria-invalid"] ?? (invalid || field?.invalid || undefined),
    "aria-labelledby": props["aria-labelledby"] ?? (props["aria-label"] ? undefined : field?.labelId),
    "aria-describedby": [props["aria-describedby"], field?.descriptionId].filter(Boolean).join(" ") || undefined,
  };
}

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
  as = "label",
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "label" | "div";
}) {
  const Shell = as;
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = error || hint ? `${id}-description` : undefined;
  return (
    <FieldContext.Provider value={{ labelId, descriptionId, invalid: !!error }}>
    <Shell className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <span id={labelId} className="text-xs font-medium text-text-soft">{label}</span>
      {children}
      {error ? (
        <span id={descriptionId} className="text-xs leading-relaxed text-danger">{error}</span>
      ) : hint ? (
        <span id={descriptionId} className="text-xs leading-relaxed text-text-soft">{hint}</span>
      ) : null}
    </Shell>
    </FieldContext.Provider>
  );
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(
  function TextInput({ className, invalid, ...props }, ref) {
    const accessibility = useFieldAccessibility(invalid, props);
    return (
      <input
        ref={ref}
        className={cn(
          FIELD_CLASS,
          invalid && "border-danger/60 focus:border-danger focus:ring-danger/20",
          className,
        )}
        {...props}
        {...accessibility}
      />
    );
  },
);

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  function TextArea({ className, invalid, rows = 4, ...props }, ref) {
    const accessibility = useFieldAccessibility(invalid, props);
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
        {...accessibility}
      />
    );
  },
);

export interface NativeSelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const NativeSelect = forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, invalid, children, ...props }, ref) {
    const accessibility = useFieldAccessibility(invalid, props);
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
          {...accessibility}
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
