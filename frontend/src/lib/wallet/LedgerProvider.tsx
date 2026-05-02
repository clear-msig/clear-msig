"use client";

// React context that holds an active Ledger session.
//
// When the user clicks "Use a Ledger" on /connect, we open a WebHID
// transport, get the pubkey, and stash a `LedgerSession` here. The
// rest of the app reads the session through `useLedger()` — most
// commonly `useWallet()`, which prefers a Ledger session over the
// Dynamic primary wallet so all signing routes through the device.
//
// The session does not persist across page reloads. WebHID requires
// a user-initiated permission grant per origin per device, and the
// Solana app must be unlocked, so re-prompting on reload is the
// least-bad UX — silently reconnecting to a possibly-locked device
// would be confusing.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  connectLedger,
  LedgerError,
  type LedgerSession,
} from "@/lib/wallet/ledger";

interface LedgerContextValue {
  /// The active session, or null when no Ledger is connected.
  session: LedgerSession | null;
  /// True while a connect attempt is in flight.
  connecting: boolean;
  /// Last connect / sign error, cleared on successful connect.
  lastError: LedgerError | null;
  /// Try to connect. Resolves on success, rejects with `LedgerError`.
  connect: () => Promise<LedgerSession>;
  /// Tear down the WebHID transport. Idempotent.
  disconnect: () => Promise<void>;
}

const LedgerContext = createContext<LedgerContextValue | null>(null);

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LedgerSession | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [lastError, setLastError] = useState<LedgerError | null>(null);
  const sessionRef = useRef<LedgerSession | null>(null);

  // Keep a ref synced with state so the cleanup effect can disconnect
  // even after unmount without dragging stale state into the closure.
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    return () => {
      if (sessionRef.current) {
        void sessionRef.current.disconnect();
      }
    };
  }, []);

  const connect = useCallback(async () => {
    setConnecting(true);
    setLastError(null);
    try {
      const next = await connectLedger();
      // If a previous session was open, close it before adopting the
      // new one. Common when the user re-clicks Connect after a
      // device hot-swap.
      if (sessionRef.current) {
        await sessionRef.current.disconnect().catch(() => undefined);
      }
      setSession(next);
      sessionRef.current = next;
      return next;
    } catch (err) {
      const ledgerErr =
        err instanceof LedgerError
          ? err
          : new LedgerError(
              "unknown",
              err instanceof Error ? err.message : "Could not connect Ledger",
            );
      setLastError(ledgerErr);
      throw ledgerErr;
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    const current = sessionRef.current;
    if (!current) return;
    sessionRef.current = null;
    setSession(null);
    setLastError(null);
    await current.disconnect().catch(() => undefined);
  }, []);

  const value = useMemo<LedgerContextValue>(
    () => ({ session, connecting, lastError, connect, disconnect }),
    [session, connecting, lastError, connect, disconnect],
  );

  return (
    <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>
  );
}

/// Read the Ledger context. Returns the inert default when consumed
/// outside a `<LedgerProvider>` so server components and tests don't
/// crash; in that case `session` is always null.
export function useLedger(): LedgerContextValue {
  const ctx = useContext(LedgerContext);
  if (ctx) return ctx;
  return INERT;
}

const INERT: LedgerContextValue = {
  session: null,
  connecting: false,
  lastError: null,
  connect: async () => {
    throw new LedgerError(
      "unsupported",
      "LedgerProvider not mounted in this tree",
    );
  },
  disconnect: async () => undefined,
};
