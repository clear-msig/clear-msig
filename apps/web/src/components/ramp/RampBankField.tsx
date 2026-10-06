"use client";

import type { BankListItem } from "@/lib/ramp/types";

export function RampBankField({
  banks,
  loading,
  failed,
  disabled,
  value,
  onChange,
  onRetry,
}: {
  banks: BankListItem[];
  loading: boolean;
  failed: boolean;
  disabled: boolean;
  value: string;
  onChange: (value: string) => void;
  onRetry: () => void;
}) {
  const unavailable = !loading && (failed || banks.length === 0);
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor="bank-select"
        className="text-xs font-semibold uppercase tracking-[0.24em] text-text-soft"
      >
        Bank
      </label>
      <select
        id="bank-select"
        aria-label="Bank"
        aria-describedby={unavailable ? "bank-read-status" : undefined}
        disabled={disabled || loading || failed || banks.length === 0}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-12 w-full rounded-soft border border-border-soft bg-canvas/50 px-3 py-3 text-sm text-text-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
      >
        <option value="">
          {loading
            ? "Loading banks…"
            : failed
              ? "Banks unavailable"
              : banks.length === 0
                ? "No banks available"
                : "Select your bank"}
        </option>
        {banks.map((bank) => (
          <option key={bank.code} value={bank.code}>
            {bank.name}
          </option>
        ))}
      </select>
      {unavailable && (
        <div
          id="bank-read-status"
          role={failed ? "alert" : "status"}
          className="rounded-soft border border-border-soft p-4 text-sm text-text-strong"
        >
          <p>
            {failed
              ? "We couldn’t load the bank list. Your account details are unchanged."
              : "No banks are available for this payout route yet."}
          </p>
          <button
            type="button"
            onClick={onRetry}
            disabled={disabled}
            className="mt-2 min-h-11 rounded-soft px-3 font-medium underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Retry bank list
          </button>
        </div>
      )}
    </div>
  );
}
