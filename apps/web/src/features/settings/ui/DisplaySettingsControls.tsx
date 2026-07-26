"use client";

import { useEffect, useState } from "react";
import clsx from "clsx";
import { Check, Coins, Hash, Monitor, Moon, Sun } from "lucide-react";
import {
  getStoredTheme,
  setStoredTheme,
  type ThemeMode,
} from "@/lib/security/theme";
import {
  getAddressFormat,
  setAddressFormat,
  type AddressFormatMode,
} from "@/lib/security/addressFormat";
import {
  ALL_DISPLAY_CURRENCIES,
  currencyLabel,
  currencySymbol,
  getDisplayCurrency,
  setDisplayCurrency,
  type DisplayCurrency,
} from "@/lib/retail/priceConversion";

export function DisplaySettingsControls() {
  return (
    <>
      <ThemeSettingRow />
      <AddressFormatRow />
      <DisplayCurrencyRow />
    </>
  );
}

// ─── Address display format ─────────────────────────────────────

function AddressFormatRow() {
  const [mode, setMode] = useState<AddressFormatMode>("abbreviated");
  useEffect(() => {
    setMode(getAddressFormat());
  }, []);
  const set = (next: AddressFormatMode) => {
    setMode(next);
    setAddressFormat(next);
    // Force a re-render of the rest of the app so addresses pick
    // up the new mode without requiring a navigate. The Settings
    // row itself reflects the change immediately; everything else
    // sees the new value on its next render. A localStorage event
    // doesn't fire in the same tab, so dispatch one ourselves so
    // any code subscribed to address-format changes can react.
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("clear:address-format-changed"));
    }
  };
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Hash className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Address display
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            How EVM + Solana addresses look in the UI. EIP-55 mixed-case
            applies to EVM only (Solana base58 has no case form).
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {(["abbreviated", "checksum", "full"] as AddressFormatMode[]).map(
          (opt) => {
            const active = mode === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => set(opt)}
                className={
                  "rounded-soft border px-3 py-2 text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                  (active
                    ? "border-accent bg-accent/[0.08] text-text-strong"
                    : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
                }
              >
                {opt === "abbreviated"
                  ? "Abbreviated"
                  : opt === "checksum"
                    ? "EIP-55"
                    : "Full"}
              </button>
            );
          },
        )}
      </div>
    </section>
  );
}

// ─── Display currency ───────────────────────────────────────────

function DisplayCurrencyRow() {
  const [currency, setCurrency] = useState<DisplayCurrency>("USD");
  useEffect(() => {
    setCurrency(getDisplayCurrency());
  }, []);
  const set = (next: DisplayCurrency) => {
    setCurrency(next);
    setDisplayCurrency(next);
  };
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Coins className="h-5 w-5" strokeWidth={1.75} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-text-strong">
            Display currency
          </p>
          <p className="mt-0.5 text-xs text-text-soft">
            Wallet totals render in this fiat. Budget caps and policy
            thresholds stay set in USD - that&rsquo;s the unit on chain.
          </p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {ALL_DISPLAY_CURRENCIES.map((opt) => {
          const active = currency === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => set(opt)}
              title={currencyLabel(opt)}
              className={
                "rounded-soft border px-3 py-2 text-center text-xs font-medium transition-[border-color,background-color,transform] duration-base ease-out-soft " +
                (active
                  ? "border-accent bg-accent/[0.08] text-text-strong"
                  : "border-border-soft bg-canvas text-text-soft hover:text-text-strong")
              }
            >
              <span className="text-base font-semibold">
                {currencySymbol(opt)}
              </span>{" "}
              {opt}
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] text-text-soft">
        Demo FX rates today. The live oracle that ships with the price
        feeds workstream replaces both the spot prices and these rates
        in one swap.
      </p>
    </section>
  );
}

// ─── Theme (light / dark / system) ──────────────────────────────

function ThemeSettingRow() {
  const [mode, setMode] = useState<ThemeMode>("system");
  useEffect(() => {
    setMode(getStoredTheme());
  }, []);
  const set = (next: ThemeMode) => {
    setMode(next);
    setStoredTheme(next);
  };

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
      {/* Header strip - mono eyebrow + display title, the same
          pattern the workspace pages use. The icon disc reflects
          the active mode so the card itself previews the choice. */}
      <header className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent"
        >
          {mode === "light" ? (
            <Sun className="h-5 w-5" strokeWidth={1.75} />
          ) : mode === "dark" ? (
            <Moon className="h-5 w-5" strokeWidth={1.75} />
          ) : (
            <Monitor className="h-5 w-5" strokeWidth={1.75} />
          )}
        </span>
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Appearance
          </p>
          <p className="mt-1 font-display text-lg leading-tight text-text-strong">
            Theme
          </p>
        </div>
      </header>

      {/* Three big preview tiles - each shows a tiny mockup of a
          card surface in that mode (sky band + card with content +
          accent dot). The active tile gets the accent ring + a
          check badge in its corner so the choice reads at a
          glance. Tiles are tap-targets ≥80px tall on mobile. */}
      <div role="radiogroup" aria-label="Theme" className="mt-5 grid grid-cols-3 gap-3">
        <ThemeTile
          id="light"
          label="Light"
          Icon={Sun}
          active={mode === "light"}
          onSelect={set}
          preview={
            <div className="h-full w-full rounded-[6px] bg-[#f6f7f9] p-1.5">
              <div className="h-1 w-3/4 rounded-full bg-[#0a0e16]/15" />
              <div className="mt-1 flex items-center gap-1 rounded-[4px] bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.06)]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#4d7c0f]" />
                <div className="h-0.5 flex-1 rounded-full bg-[#0a0e16]/25" />
              </div>
              <div className="mt-1 h-0.5 w-1/2 rounded-full bg-[#0a0e16]/15" />
            </div>
          }
        />
        <ThemeTile
          id="system"
          label="System"
          Icon={Monitor}
          active={mode === "system"}
          onSelect={set}
          preview={
            <div className="grid h-full w-full grid-cols-2 overflow-hidden rounded-[6px]">
              <div className="bg-[#f6f7f9] p-1.5">
                <div className="h-1 w-3/4 rounded-full bg-[#0a0e16]/15" />
                <div className="mt-1 h-1 w-1/2 rounded-full bg-[#4d7c0f]" />
              </div>
              <div className="bg-[#0a0a0a] p-1.5">
                <div className="h-1 w-3/4 rounded-full bg-white/15" />
                <div className="mt-1 h-1 w-1/2 rounded-full bg-[#ccff00]" />
              </div>
            </div>
          }
        />
        <ThemeTile
          id="dark"
          label="Dark"
          Icon={Moon}
          active={mode === "dark"}
          onSelect={set}
          preview={
            <div className="h-full w-full rounded-[6px] bg-[#0a0a0a] p-1.5">
              <div className="h-1 w-3/4 rounded-full bg-white/15" />
              <div className="mt-1 flex items-center gap-1 rounded-[4px] bg-[#131316] p-1">
                <span className="h-1.5 w-1.5 rounded-full bg-[#ccff00]" />
                <div className="h-0.5 flex-1 rounded-full bg-white/25" />
              </div>
              <div className="mt-1 h-0.5 w-1/2 rounded-full bg-white/15" />
            </div>
          }
        />
      </div>

      <p className="mt-4 text-[11px] text-text-soft">
        Saved on this device. Changes fade in over ~220ms.
      </p>
    </section>
  );
}

function ThemeTile({
  id,
  label,
  Icon,
  active,
  onSelect,
  preview,
}: {
  id: ThemeMode;
  label: string;
  Icon: typeof Sun;
  active: boolean;
  onSelect: (m: ThemeMode) => void;
  preview: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(id)}
      className={clsx(
        "group relative flex flex-col items-stretch gap-2 rounded-card border bg-canvas p-2.5 text-left",
        "transition-[border-color,background-color,transform,box-shadow] duration-base ease-out-soft",
        "hover:-translate-y-0.5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        active
          ? "border-accent shadow-accent-rest"
          : "border-border-soft hover:border-border-strong",
      )}
    >
      {/* Mini preview swatch - aspect-square keeps the proportions
          tidy across the 3-up grid regardless of column width. */}
      <div className="relative aspect-square w-full overflow-hidden rounded-soft border border-border-soft/40">
        {preview}
        {active && (
          <span
            aria-hidden="true"
            className="absolute right-1 top-1 inline-flex h-4 w-4 items-center justify-center rounded-full bg-accent text-text-on-accent shadow-sm"
          >
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
        )}
      </div>
      <span
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 text-[11px] font-medium",
          active ? "text-text-strong" : "text-text-soft group-hover:text-text-strong",
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
        {label}
      </span>
    </button>
  );
}
