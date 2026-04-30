"use client";

// Minimal dependency-free toast system.
//
// Design choices:
//   - Zero external library (react-hot-toast, sonner) . we get the 95%
//     of behaviour we need in ~150 LOC and keep bundle size minimal.
//   - A single shared queue is exposed via `useToast()`; every write
//     path (create wallet, sign, broadcast) calls the same helpers.
//   - Toasts stack in the bottom-right on desktop, top on mobile.
//   - Three kinds: success (accent), error (rose), info (neutral).
//   - Errors get a "details" disclosure so we don't wall-of-text the
//     user, but power users can still see the raw backend stderr.
//
// Consumers:
//   import { useToast } from "@/components/ui/Toast";
//   const toast = useToast();
//   toast.success("Multisig 'treasury' created", { link: explorerUrl });
//   toast.error("Rate limited . try again in 60s");

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
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, X, ExternalLink, AlertTriangle } from "lucide-react";

type ToastKind = "success" | "error" | "info";

interface ToastOptions {
  /// Optional link rendered as a right-aligned chip. Use for explorer
  /// links, transaction IDs, etc.
  link?: { label: string; href: string };
  /// Secondary info shown in a collapsed "details" pane (mainly for
  /// errors . the backend's `stderr` / `kind` fields).
  details?: string;
  /// Auto-dismiss timeout (ms). Defaults: 4000 for success/info, 8000
  /// for errors. Pass 0 to pin.
  durationMs?: number;
}

interface ToastEntry extends ToastOptions {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastAPI {
  success: (message: string, opts?: ToastOptions) => number;
  error: (message: string, opts?: ToastOptions) => number;
  info: (message: string, opts?: ToastOptions) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastAPI | null>(null);

/// Provider . mount once near the root (AppProviders).
export function ToastProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string, opts: ToastOptions = {}): number => {
      const id = nextId.current++;
      const entry: ToastEntry = { id, kind, message, ...opts };
      setEntries((prev) => [...prev, entry]);
      const duration = opts.durationMs ?? (kind === "error" ? 8000 : 4000);
      if (duration > 0) {
        const t = setTimeout(() => dismiss(id), duration);
        timers.current.set(id, t);
      }
      return id;
    },
    [dismiss]
  );

  const api = useMemo<ToastAPI>(
    () => ({
      success: (m, o) => push("success", m, o),
      error: (m, o) => push("error", m, o),
      info: (m, o) => push("info", m, o),
      dismiss,
    }),
    [push, dismiss]
  );

  // Clear outstanding timers on unmount.
  useEffect(() => {
    return () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastStack entries={entries} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

/// Hook form . throws if no provider is mounted (catches missing-setup
/// bugs early).
export function useToast(): ToastAPI {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast: wrap the tree in <ToastProvider>");
  }
  return ctx;
}

// ── rendering ─────────────────────────────────────────────────────────

function ToastStack({
  entries,
  onDismiss,
}: {
  entries: ToastEntry[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      // Bottom-right on ≥sm, top-center on mobile . with safe padding
      // so we never collide with the mobile bottom tab bar.
      className="pointer-events-none fixed inset-x-0 top-4 z-[200] flex flex-col items-center gap-2 px-4 sm:inset-auto sm:bottom-6 sm:right-6 sm:top-auto sm:items-end sm:px-0"
      role="region"
      aria-label="Notifications"
    >
      <AnimatePresence initial={false}>
        {entries.map((e) => (
          <ToastItem key={e.id} entry={e} onDismiss={() => onDismiss(e.id)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastItem({
  entry,
  onDismiss,
}: {
  entry: ToastEntry;
  onDismiss: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const Icon = iconFor(entry.kind);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -12, scale: 0.9 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      role="status"
      aria-live={entry.kind === "error" ? "assertive" : "polite"}
      className={[
        "pointer-events-auto w-full max-w-sm rounded-2xl border px-4 py-3 shadow-2xl backdrop-blur",
        "flex flex-col gap-2",
        entry.kind === "success" &&
          "border-accent/30 bg-surface-card/90 text-white",
        entry.kind === "error" &&
          "border-rose-500/40 bg-rose-950/90 text-rose-50",
        entry.kind === "info" && "border-white/15 bg-surface-card/90 text-white",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-start gap-3">
        <Icon
          size={18}
          className={
            entry.kind === "success"
              ? "mt-0.5 shrink-0 text-accent"
              : entry.kind === "error"
              ? "mt-0.5 shrink-0 text-rose-300"
              : "mt-0.5 shrink-0 text-white/70"
          }
        />
        <div className="flex-1 text-sm leading-snug">{entry.message}</div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="rounded-full p-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X size={14} />
        </button>
      </div>

      {(entry.link || entry.details) && (
        <div className="flex items-center justify-between gap-2 pl-7">
          {entry.link ? (
            <a
              href={entry.link.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold text-accent hover:underline"
            >
              {entry.link.label}
              <ExternalLink size={12} />
            </a>
          ) : (
            <span />
          )}
          {entry.details && (
            <button
              onClick={() => setShowDetails((v) => !v)}
              className="text-xs font-medium text-white/50 underline-offset-2 hover:text-white/80 hover:underline"
            >
              {showDetails ? "hide details" : "details"}
            </button>
          )}
        </div>
      )}

      {showDetails && entry.details && (
        <pre className="max-h-40 overflow-auto rounded-lg bg-surface-card/40 p-2 pl-7 text-[11px] font-mono leading-snug text-white/70">
          {entry.details}
        </pre>
      )}
    </motion.div>
  );
}

function iconFor(kind: ToastKind) {
  switch (kind) {
    case "success":
      return CheckCircle2;
    case "error":
      return AlertTriangle;
    case "info":
      return Info;
  }
}
