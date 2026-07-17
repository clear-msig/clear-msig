import type { InputHTMLAttributes, ReactNode } from "react";
import clsx from "clsx";

interface SendAmountFieldProps {
  id: string;
  ticker: string;
  value: string;
  onChange: InputHTMLAttributes<HTMLInputElement>["onChange"];
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  maxLength?: number;
  action?: ReactNode;
  footer?: ReactNode;
  warning?: ReactNode;
  className?: string;
  inputClassName?: string;
}

export function SendAmountField({
  id,
  ticker,
  value,
  onChange,
  label = "Amount",
  placeholder = "0",
  disabled,
  autoFocus,
  maxLength,
  action,
  footer,
  warning,
  className,
  inputClassName,
}: SendAmountFieldProps) {
  return (
    <div className={clsx("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-3">
        <label
          htmlFor={id}
          className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft"
        >
          {label}
        </label>
        {action}
      </div>
      <div
        className={
          "flex min-h-[5rem] items-center gap-3 rounded-soft border border-border-soft bg-canvas px-3.5 py-3 " +
          "transition-[border-color,background-color] duration-base ease-out-soft focus-within:border-accent/60"
        }
      >
        <input
          id={id}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={maxLength}
          aria-label={`${label} in ${ticker}`}
          spellCheck={false}
          autoComplete="off"
          className={clsx(
            "min-w-0 flex-1 bg-transparent font-numerals text-3xl font-semibold text-text-strong tabular-nums outline-none placeholder:text-text-soft/50 sm:text-4xl",
            "disabled:cursor-not-allowed disabled:opacity-60",
            inputClassName,
          )}
        />
        <span
          aria-hidden="true"
          className="shrink-0 font-display text-base font-semibold uppercase tracking-[0.18em] text-text-soft sm:text-lg"
        >
          {ticker}
        </span>
      </div>
      {footer ? <div className="text-xs text-text-soft">{footer}</div> : null}
      {warning ? (
        <div className="rounded-soft border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-text-strong">
          {warning}
        </div>
      ) : null}
    </div>
  );
}
