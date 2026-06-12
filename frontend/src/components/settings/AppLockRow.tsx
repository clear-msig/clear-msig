"use client";

// App lock - per-device PIN that gates /app/* on every fresh tab.
// Stored in localStorage with a salted hash; the PIN itself never
// leaves the device.
//
// User-first redesign:
//   • Status pill at the top right reads "Enabled" / "Disabled"
//     instead of "(on)" / "(off)" buried in the title.
//   • Resting card shows the icon + name + current state. Action
//     buttons live in a footer bar separated from the description so
//     primary / destructive intents can be distinguished cleanly:
//       - Lock now    (neutral ghost)
//       - Change PIN  (neutral ghost)
//       - Disable     (rose ghost - destructive intent)
//   • The set/change/disable form expands inline below the footer
//     with a smooth height + opacity animation; PIN inputs are tall,
//     monospace, and use generous letter-spacing so digits read like
//     a proper PIN entry, not a generic password field.

import { useEffect, useState } from "react";
import clsx from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { Lock, ShieldCheck } from "lucide-react";
import {
  clearPin,
  getAppLockState,
  lockNow,
  setPin as setAppLockPin,
  verifyPin,
} from "@/lib/security/appLock";
import { Button } from "@/components/retail/Button";

type EditMode = "set" | "change" | "disable" | null;

export function AppLockRow() {
  const [hasPin, setHasPin] = useState(false);
  const [editing, setEditing] = useState<EditMode>(null);
  const refresh = () => setHasPin(getAppLockState().hasPin);
  useEffect(() => {
    refresh();
  }, []);

  const handleLockNow = () => {
    lockNow();
    window.location.reload();
  };

  return (
    <section className="overflow-hidden rounded-card border border-border-soft bg-surface-raised shadow-card-rest">
      <div className="flex items-start gap-3 p-5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-text-strong">App lock</p>
            <StatusPill on={hasPin} />
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {hasPin
              ? "A 4–8 digit PIN is required before your wallets are visible on this device. Stored locally - we never see your PIN."
              : "Add a 4–8 digit PIN to gate access on this device. Stored locally - we never see your PIN."}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border-soft px-5 py-3">
        {hasPin ? (
          <>
            <button
              type="button"
              onClick={handleLockNow}
              title="Lock this tab now and require the PIN to continue"
              className={ghostButtonClass}
            >
              <Lock size={13} strokeWidth={2} aria-hidden="true" />
              Lock now
            </button>
            <button
              type="button"
              onClick={() => setEditing(editing === "change" ? null : "change")}
              aria-pressed={editing === "change"}
              className={clsx(
                ghostButtonClass,
                editing === "change" && "border-accent/40 text-text-strong",
              )}
            >
              Change PIN
            </button>
            <button
              type="button"
              onClick={() => setEditing(editing === "disable" ? null : "disable")}
              aria-pressed={editing === "disable"}
              className={clsx(
                "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium",
                "transition-colors duration-base ease-out-soft",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                editing === "disable"
                  ? "border-rose-500/40 bg-rose-500/[0.06] text-rose-500"
                  : "border-border-soft text-text-soft hover:border-rose-500/40 hover:text-rose-500",
              )}
            >
              Disable
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(editing === "set" ? null : "set")}
            aria-pressed={editing === "set"}
            className={clsx(
              "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest",
              "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
              "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
            )}
          >
            Set PIN
          </button>
        )}
      </div>

      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key={editing}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="border-t border-border-soft bg-canvas/40"
          >
            <PinForm
              mode={editing}
              onClose={() => setEditing(null)}
              onSaved={() => {
                refresh();
                setEditing(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

const ghostButtonClass = clsx(
  "inline-flex min-h-tap items-center justify-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-1.5 text-xs font-medium text-text-soft",
  "transition-colors duration-base ease-out-soft hover:border-border-strong hover:text-text-strong",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
);

function StatusPill({ on }: { on: boolean }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium",
        on
          ? "border-accent/30 bg-accent/[0.08] text-accent"
          : "border-border-soft bg-canvas text-text-soft",
      )}
    >
      {on ? "Enabled" : "Disabled"}
    </span>
  );
}

function PinForm({
  mode,
  onClose,
  onSaved,
}: {
  mode: "set" | "change" | "disable";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      if (mode === "change" || mode === "disable") {
        const ok = await verifyPin(current);
        if (!ok) {
          setErr("Current PIN is wrong");
          return;
        }
      }
      if (mode === "disable") {
        clearPin();
        onSaved();
        return;
      }
      if (next.length < 4 || next.length > 8 || !/^\d+$/.test(next)) {
        setErr("New PIN must be 4–8 digits");
        return;
      }
      if (next !== confirm) {
        setErr("New PIN doesn't match the confirmation");
        return;
      }
      await setAppLockPin(next);
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save PIN");
    } finally {
      setBusy(false);
    }
  };

  const heading =
    mode === "set"
      ? "Set a PIN"
      : mode === "change"
        ? "Change your PIN"
        : "Disable app lock";

  const submitLabel = busy
    ? "Saving…"
    : mode === "set"
      ? "Set PIN"
      : mode === "change"
        ? "Change PIN"
        : "Disable PIN";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="flex flex-col gap-4 p-5"
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
        {heading}
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {(mode === "change" || mode === "disable") && (
          <PinInput
            label="Current PIN"
            value={current}
            onChange={setCurrent}
            autoFocus
          />
        )}
        {mode !== "disable" && (
          <PinInput
            label={mode === "change" ? "New PIN" : "New PIN (4–8 digits)"}
            value={next}
            onChange={setNext}
            autoFocus={mode === "set"}
          />
        )}
        {mode !== "disable" && (
          <PinInput
            label="Confirm new PIN"
            value={confirm}
            onChange={setConfirm}
          />
        )}
      </div>

      {err && (
        <p className="text-xs text-warning" role="alert">
          {err}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-soft px-3 py-2 text-xs font-medium text-text-soft transition-colors duration-base ease-out-soft hover:text-text-strong"
        >
          Cancel
        </button>
        <Button type="submit" size="md" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function PinInput({
  label,
  value,
  onChange,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-text-soft">
        {label}
      </span>
      <input
        type="password"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        onChange={(e) =>
          onChange(e.target.value.replace(/\D/g, "").slice(0, 8))
        }
        autoFocus={autoFocus}
        placeholder="••••"
        className={clsx(
          "rounded-soft border border-border-soft bg-surface-raised px-3 py-2.5",
          "font-mono text-lg tracking-[0.5em] text-text-strong outline-none",
          "transition-[border-color,box-shadow] duration-base ease-out-soft",
          "placeholder:text-text-soft/40",
          "focus:border-accent focus:shadow-accent-rest",
        )}
      />
    </label>
  );
}
