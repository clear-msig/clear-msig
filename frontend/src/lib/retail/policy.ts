"use client";

// Policy v1 - client-side spending policies that enforce at sign time.
//
// Three new fields on top of what /budget + /allowances already do:
//
//   1. Allowlist of recipients. When `mode = "on"`, sends to addresses
//      not on the list are blocked at the /send pre-flight check.
//      When `mode = "off"`, the list is ignored (default).
//
//   2. Time-of-day window. Optional. When enabled, sends are blocked
//      outside the allowed hours / days-of-week local time. Useful
//      for treasuries that want "no late-night sends" guardrails.
//
// Both store per-wallet in localStorage. They join the existing
// per-friend allowance + wallet-wide budget under one evaluator
// (see lib/retail/policyEvaluation.ts).
//
// **Enforcement is client-side until the on-chain program grows
// FHE-aware policy slots.** Same disclosure as /budget: a motivated
// user opening DevTools can defeat any of these checks. Honest
// framing matters - /policy chips say "pre-alpha" and /SECURITY.md
// describes the gap.

const ALLOWLIST_KEY = "clear-msig:policy.allowlist:v1";
const TIME_WINDOW_KEY = "clear-msig:policy.timeWindow:v1";
const EMERGENCY_PAUSE_KEY = "clear-msig:policy.emergencyPause:v1";

// ── Allowlist ───────────────────────────────────────────────────────

export type AllowlistMode = "off" | "on";

export interface Allowlist {
  walletName: string;
  mode: AllowlistMode;
  /// Allowed recipient addresses (base58). Honoured when `mode === "on"`.
  /// Empty array + `mode = "on"` blocks every send (failsafe).
  addresses: string[];
  /// Set on every save so the UI can render "edited 2h ago".
  updatedAt: number;
}

function loadAllowlists(): Allowlist[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(ALLOWLIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isAllowlist);
  } catch {
    return [];
  }
}

function persistAllowlists(rows: Allowlist[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ALLOWLIST_KEY, JSON.stringify(rows));
  } catch {
    /* localStorage full or blocked - fall through */
  }
}

export function getAllowlist(walletName: string): Allowlist {
  const found = loadAllowlists().find((r) => r.walletName === walletName);
  return (
    found ?? {
      walletName,
      mode: "off",
      addresses: [],
      updatedAt: 0,
    }
  );
}

export function saveAllowlist(input: Omit<Allowlist, "updatedAt">): Allowlist {
  const all = loadAllowlists().filter((r) => r.walletName !== input.walletName);
  const record: Allowlist = {
    ...input,
    addresses: dedupe(input.addresses).slice(0, 200),
    updatedAt: Date.now(),
  };
  all.push(record);
  persistAllowlists(all);
  return record;
}

// ── Time window ─────────────────────────────────────────────────────

export interface TimeWindow {
  walletName: string;
  enabled: boolean;
  /// 0-23 in the user's local time. `endHour` is exclusive. When
  /// startHour < endHour the window is the inclusive-exclusive
  /// interval. When startHour > endHour the window crosses midnight
  /// (e.g. 22 → 6 means 10pm to 6am next morning).
  startHour: number;
  endHour: number;
  /// Days of the week the window applies. Sunday = 0, Saturday = 6.
  /// Empty array means "no day allowed" (failsafe). The default
  /// constructor returns all 7 so consumers don't accidentally lock
  /// themselves out.
  daysOfWeek: number[];
  updatedAt: number;
}

function loadTimeWindows(): TimeWindow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TIME_WINDOW_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isTimeWindow);
  } catch {
    return [];
  }
}

function persistTimeWindows(rows: TimeWindow[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TIME_WINDOW_KEY, JSON.stringify(rows));
  } catch {
    /* fall through */
  }
}

export function getTimeWindow(walletName: string): TimeWindow {
  const found = loadTimeWindows().find((r) => r.walletName === walletName);
  return (
    found ?? {
      walletName,
      enabled: false,
      startHour: 9,
      endHour: 18,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      updatedAt: 0,
    }
  );
}

export function saveTimeWindow(
  input: Omit<TimeWindow, "updatedAt">,
): TimeWindow {
  const all = loadTimeWindows().filter((r) => r.walletName !== input.walletName);
  const record: TimeWindow = {
    ...input,
    startHour: clampHour(input.startHour),
    endHour: clampHour(input.endHour),
    daysOfWeek: Array.from(new Set(input.daysOfWeek))
      .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      .sort(),
    updatedAt: Date.now(),
  };
  all.push(record);
  persistTimeWindows(all);
  return record;
}

// ── Emergency pause ────────────────────────────────────────────────

export interface EmergencyPause {
  walletName: string;
  paused: boolean;
  updatedAt: number;
}

function loadEmergencyPauses(): EmergencyPause[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(EMERGENCY_PAUSE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEmergencyPause);
  } catch {
    return [];
  }
}

function persistEmergencyPauses(rows: EmergencyPause[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(EMERGENCY_PAUSE_KEY, JSON.stringify(rows));
  } catch {
    /* localStorage full or blocked - fall through */
  }
}

export function getEmergencyPause(walletName: string): EmergencyPause {
  return (
    loadEmergencyPauses().find((row) => row.walletName === walletName) ?? {
      walletName,
      paused: false,
      updatedAt: 0,
    }
  );
}

export function saveEmergencyPause(
  walletName: string,
  paused: boolean,
): EmergencyPause {
  const all = loadEmergencyPauses().filter((row) => row.walletName !== walletName);
  const record: EmergencyPause = {
    walletName,
    paused,
    updatedAt: Date.now(),
  };
  all.push(record);
  persistEmergencyPauses(all);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("clear:emergency-pause-changed"));
  }
  return record;
}

/// Test whether `now` falls inside the window. When the window is
/// disabled, every time is "in window". When days-of-week is empty,
/// every day is blocked (failsafe).
export function isInsideTimeWindow(window: TimeWindow, now: Date): boolean {
  if (!window.enabled) return true;
  if (window.daysOfWeek.length === 0) return false;
  if (!window.daysOfWeek.includes(now.getDay())) return false;
  const hour = now.getHours();
  const { startHour, endHour } = window;
  if (startHour === endHour) return false;
  if (startHour < endHour) {
    return hour >= startHour && hour < endHour;
  }
  // Window crosses midnight (e.g. 22 → 6).
  return hour >= startHour || hour < endHour;
}

// ── Helpers ─────────────────────────────────────────────────────────

function isAllowlist(r: unknown): r is Allowlist {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    (o.mode === "off" || o.mode === "on") &&
    Array.isArray(o.addresses) &&
    typeof o.updatedAt === "number"
  );
}

function isTimeWindow(r: unknown): r is TimeWindow {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    typeof o.enabled === "boolean" &&
    typeof o.startHour === "number" &&
    typeof o.endHour === "number" &&
    Array.isArray(o.daysOfWeek) &&
    typeof o.updatedAt === "number"
  );
}

function isEmergencyPause(r: unknown): r is EmergencyPause {
  if (!r || typeof r !== "object") return false;
  const o = r as Record<string, unknown>;
  return (
    typeof o.walletName === "string" &&
    typeof o.paused === "boolean" &&
    typeof o.updatedAt === "number"
  );
}

function dedupe<T>(xs: T[]): T[] {
  return Array.from(new Set(xs));
}

function clampHour(h: number): number {
  if (!Number.isFinite(h)) return 0;
  const v = Math.floor(h);
  if (v < 0) return 0;
  if (v > 23) return 23;
  return v;
}

/// User-facing day labels for the editor.
export const DAY_LABELS: ReadonlyArray<{ value: number; short: string; long: string }> = [
  { value: 0, short: "Sun", long: "Sunday" },
  { value: 1, short: "Mon", long: "Monday" },
  { value: 2, short: "Tue", long: "Tuesday" },
  { value: 3, short: "Wed", long: "Wednesday" },
  { value: 4, short: "Thu", long: "Thursday" },
  { value: 5, short: "Fri", long: "Friday" },
  { value: 6, short: "Sat", long: "Saturday" },
];
