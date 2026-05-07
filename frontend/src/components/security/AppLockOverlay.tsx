"use client";

// Full-viewport gate that intercepts /app/* surfaces when a PIN is
// configured + this tab hasn't been unlocked yet. The gate hides
// children entirely (the wallet hub, balances, pending approvals,
// member list, settings — everything) until the user enters the
// right PIN.
//
// The component renders at the workspace-layout level. When
// hasPin && !unlocked, it returns the lock UI INSTEAD of the
// children, so even React doesn't try to mount the protected tree.
// That's important: the dashboard hooks fire on mount and the
// Notification ping logic + tx history queries shouldn't run
// while the user hasn't proven who they are.

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ShieldCheck, Loader2 } from "lucide-react";
import { BrandMark } from "@/components/retail/BrandMark";
import {
  getAppLockState,
  markUnlocked,
  verifyPin,
} from "@/lib/security/appLock";

interface Props {
  /// What to render once unlocked (or when no PIN is configured).
  children: React.ReactNode;
}

export function AppLockOverlay({ children }: Props) {
  // Hydrate on mount — server can't read storage. Until we know,
  // assume locked-no-pin (renders children) so SSR + first paint
  // are stable. The check fires immediately client-side and flips
  // state correctly within a tick.
  const [hydrated, setHydrated] = useState(false);
  const [unlocked, setUnlocked] = useState(true);
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    const s = getAppLockState();
    setHasPin(s.hasPin);
    setUnlocked(s.unlocked);
    setHydrated(true);
  }, []);

  if (!hydrated) return <>{children}</>;
  if (!hasPin || unlocked) return <>{children}</>;

  return (
    <Gate
      onUnlock={() => {
        markUnlocked();
        setUnlocked(true);
      }}
    />
  );
}

function Gate({ onUnlock }: { onUnlock: () => void }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Throttle on repeated wrong PINs. PBKDF2 is already slow enough
  // (~50ms per check) that brute-force is impractical, but a
  // visible delay after 3 wrong tries is honest UX about the gate
  // being a real check, not security theater.
  const cooldownMs = attempts >= 3 ? 1500 : 0;

  const handleSubmit = async () => {
    if (busy) return;
    if (!/^\d{4,8}$/.test(pin)) {
      setError("PIN must be 4–8 digits");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (cooldownMs > 0) {
        await new Promise((r) => setTimeout(r, cooldownMs));
      }
      const ok = await verifyPin(pin);
      if (ok) {
        setPin("");
        setAttempts(0);
        onUnlock();
      } else {
        setError("Wrong PIN");
        setAttempts((n) => n + 1);
        setPin("");
        inputRef.current?.focus();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't verify PIN");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-canvas px-6">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm rounded-card border border-border-soft bg-surface-raised p-8 text-center shadow-card-rest"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <ShieldCheck className="h-6 w-6" strokeWidth={2} aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display text-display-xs leading-tight text-text-strong">
          Enter your PIN
        </h1>
        <p className="mt-2 text-sm text-text-soft">
          This device asks for a PIN before showing your wallets.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
          className="mt-6 flex flex-col gap-3"
        >
          <input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            value={pin}
            onChange={(e) =>
              setPin(e.target.value.replace(/\D/g, "").slice(0, 8))
            }
            placeholder="• • • •"
            maxLength={8}
            aria-label="PIN"
            className={
              "rounded-card border border-border-soft bg-canvas px-4 py-3 text-center font-display text-2xl tracking-[0.5em] text-text-strong outline-none " +
              "transition-[border-color,box-shadow] duration-base ease-out-soft " +
              "focus:border-accent focus:shadow-accent-rest"
            }
          />
          <button
            type="submit"
            disabled={busy || pin.length < 4}
            className={
              "inline-flex items-center justify-center gap-1.5 rounded-full bg-accent px-4 py-2.5 text-sm font-medium text-white " +
              "transition-[background-color,transform] duration-base ease-out-soft " +
              "hover:bg-accent-hover active:scale-[0.98] " +
              "disabled:cursor-not-allowed disabled:opacity-50 " +
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised"
            }
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                Checking…
              </>
            ) : (
              "Unlock"
            )}
          </button>
          {error && (
            <p className="text-xs text-warning" role="alert">
              {error}
            </p>
          )}
          {attempts >= 3 && (
            <p className="text-[11px] text-text-soft">
              Forgot your PIN? Reset by clearing this site's data in
              your browser. You'll need to reconnect your wallet
              after.
            </p>
          )}
        </form>
      </motion.div>
      <div className="mt-6 inline-flex items-center gap-1.5 text-[11px] text-text-soft">
        <BrandMark size={14} />
        <span>Clear · saved on this device only</span>
      </div>
    </div>
  );
}
