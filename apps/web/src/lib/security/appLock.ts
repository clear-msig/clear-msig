"use client";

// Per-device PIN gate before any /app/* surface renders.
//
// Threat model: shared devices and unlocked laptops. Dynamic's
// session token persists across browser tabs and reloads - anyone
// who opens the laptop can navigate to /app/wallet/<name> and see
// balances, pending approvals, and tap into sign flows. The PIN
// lock interposes a per-tab gate so the cost of "leaving the
// browser unlocked" stops at "see balances, can't sign without the
// PIN this session".
//
// What this is NOT: a secret-key protector. The PIN doesn't encrypt
// any sensitive data - Dynamic still holds the wallet on its
// servers, contacts/attempts/seen-notifications still live in
// localStorage in the clear. The PIN's job is to hide the UI
// surface from a casual passer-by, not to defeat a malicious
// extension or a determined attacker with full local-storage read.
//
// Why not hash with bcrypt: we'd need a JS bcrypt implementation
// and the bundle cost is real. PBKDF2 via the platform Web Crypto
// API is universal, hardware-accelerated where available, and good
// enough for the threat model (shoulder-surfing / casual access).
// 200k iterations + 16-byte salt + SHA-256 puts a wrong-PIN guess
// at ~50ms, slow enough that a determined attacker's brute-force
// is constrained but the legit user's unlock is imperceptible.
//
// Storage:
//   localStorage["clear.applock.v1"]
//     = JSON { salt: hex, hash: hex, iterations, version }
//   sessionStorage["clear.applock.unlocked.v1"] = "1" when unlocked
//
// Per-tab unlock: a new tab opening starts at sessionStorage's
// blank slate, so it's locked even when the original tab is
// unlocked. That's the security contract - re-prompt on every
// fresh context.

const STORAGE_KEY = "clear.applock.v1";
const SESSION_KEY = "clear.applock.unlocked.v1";
const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

interface StoredPin {
  salt: string;
  hash: string;
  iterations: number;
  version: 1;
}

function isStoredPin(x: unknown): x is StoredPin {
  if (!x || typeof x !== "object") return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.salt === "string" &&
    typeof r.hash === "string" &&
    typeof r.iterations === "number" &&
    r.version === 1
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function pbkdf2(
  pin: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    key,
    HASH_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export interface AppLockState {
  /// True when a PIN is configured for this device.
  hasPin: boolean;
  /// True when this tab has been unlocked since the PIN was set.
  /// Always false when hasPin is false.
  unlocked: boolean;
}

/// Read the lock state synchronously. Safe to call during render -
/// no async work, just localStorage + sessionStorage reads.
export function getAppLockState(): AppLockState {
  if (typeof window === "undefined") {
    return { hasPin: false, unlocked: true };
  }
  let hasPin = false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      hasPin = isStoredPin(parsed);
    }
  } catch {
    /* ignore */
  }
  if (!hasPin) return { hasPin: false, unlocked: true };
  let unlocked = false;
  try {
    unlocked = window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    /* sessionStorage blocked - treat as locked */
  }
  return { hasPin: true, unlocked };
}

/// Hash the candidate PIN with the stored salt + iterations and
/// constant-time compare against the stored hash. Returns true on
/// match. Throws if no PIN is configured.
export async function verifyPin(pin: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("no PIN configured");
  const stored = JSON.parse(raw) as StoredPin;
  if (!isStoredPin(stored)) throw new Error("invalid PIN record");
  const computed = await pbkdf2(
    pin,
    hexToBytes(stored.salt),
    stored.iterations,
  );
  const expected = hexToBytes(stored.hash);
  if (computed.length !== expected.length) return false;
  // Constant-time compare. A timing leak here would let an attacker
  // distinguish "first byte matched" from "first byte didn't" via
  // microtiming, narrowing a brute-force search.
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed[i] ^ expected[i];
  }
  return diff === 0;
}

/// Set or replace the device PIN. Caller must already have verified
/// the user knows the existing PIN (if any) - this function does
/// not gate on it.
export async function setPin(pin: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!/^\d{4,8}$/.test(pin)) {
    throw new Error("PIN must be 4-8 digits");
  }
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const hash = await pbkdf2(pin, salt, PBKDF2_ITERATIONS);
  const stored: StoredPin = {
    salt: bytesToHex(salt),
    hash: bytesToHex(hash),
    iterations: PBKDF2_ITERATIONS,
    version: 1,
  };
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  // Setting a PIN also unlocks this tab - no point requiring the
  // user to immediately re-enter the value they just typed.
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/// Mark this tab as unlocked for the rest of the session. Caller
/// is responsible for verifying the PIN before flipping this.
export function markUnlocked(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_KEY, "1");
  } catch {
    /* ignore */
  }
}

/// Re-lock the current tab without removing the configured PIN.
/// Used by an explicit "Lock now" affordance. The next render hits
/// the gate and prompts again.
export function lockNow(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/// Disable the device PIN entirely. Caller must verify the existing
/// PIN before calling this (the Settings flow handles that). Also
/// clears the unlocked flag so the next /app/* mount doesn't keep
/// rendering as if locked-was-on.
export function clearPin(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}
