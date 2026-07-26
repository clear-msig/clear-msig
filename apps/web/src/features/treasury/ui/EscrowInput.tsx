"use client";

export function EscrowInput({
  label,
  value,
  placeholder,
  inputMode,
  suffix,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  inputMode?: "decimal" | "text";
  suffix?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[10px] font-semibold uppercase tracking-[0.22em] text-text-soft">
        {label}
      </span>
      <span className="flex min-h-tap items-center rounded-soft border border-border-soft bg-canvas px-3 transition focus-within:border-accent/50">
        <input
          aria-label={label}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode={inputMode}
          placeholder={placeholder}
          className="min-w-0 flex-1 bg-transparent py-3 text-sm text-text-strong placeholder:text-text-soft/60 focus:outline-none"
        />
        {suffix ? (
          <span className="ml-2 text-xs font-semibold uppercase tracking-[0.18em] text-text-soft">
            {suffix}
          </span>
        ) : null}
      </span>
    </label>
  );
}
