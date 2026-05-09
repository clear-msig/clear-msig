// Secret-key parser + wipe helpers for the Secure import flow.
//
// Threat model — what this module defends against:
//   - Bad paste / wrong format. Returns a structured error with copy
//     the wizard can render inline; never throws or logs raw input.
//   - Accidental persistence. Callers MUST hold the parsed Keypair in
//     a non-React-state ref (or clear React state on unmount) and call
//     `wipeKeypair` once they no longer need it. This module never
//     touches localStorage / IndexedDB / cookies.
//   - Stale memory. `wipeKeypair` zero-fills the Keypair's secretKey
//     buffer. JS GC + V8 don't guarantee perfect memory hygiene, but
//     overwriting the buffer narrows the window where a heap dump
//     could leak the key.
//
// What this module CAN'T defend against (page-level concerns):
//   - Browser extensions reading <input> values.
//   - Malicious browser screenshots / screen sharing.
//   - HTTPS downgrade (the page should pre-flight `isSecureContext`).
//   - Phishing — user pasting their key into a fake clone of this UI.
//     The wizard MUST surface a clear warning so the user knows the
//     authentic origin.

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export type ParseKeyError =
  | "empty"
  | "invalid-base58"
  | "invalid-json"
  | "invalid-length"
  | "invalid-keypair";

export interface ParseKeyOk {
  ok: true;
  keypair: Keypair;
  format: "base58" | "json";
  /**
   * Best-effort wipe — zeroes both the buffer we decoded into AND the
   * Keypair's internal `_keypair.secretKey` (modern @solana/web3.js
   * returns a copy from the `.secretKey` getter, so `kp.secretKey.fill(0)`
   * alone wipes the wrong buffer). Call once you no longer need the
   * keypair (typically right after the import-tx broadcast confirms).
   * Idempotent + safe to call repeatedly.
   */
  wipe: () => void;
}

export interface ParseKeyErr {
  ok: false;
  error: ParseKeyError;
  /** User-facing reason. Safe to render inline; never echoes the input. */
  reason: string;
}

export type ParseKeyResult = ParseKeyOk | ParseKeyErr;

/**
 * Parse a Solana secret key from raw user-pasted input. Accepts:
 *
 *   - **Base58** — 64-byte secret key encoded as a base58 string. This
 *     is the format Phantom + Solflare emit on "Export private key".
 *     Decoded length must be exactly 64 (the Ed25519 keypair seed +
 *     pubkey concatenated).
 *   - **JSON** — `[1,2,3,...,64]` array of 64 integers in [0,255].
 *     This is the format `solana-keygen new --outfile id.json`
 *     produces.
 *
 * Trims whitespace + strips surrounding ASCII quotes (some users
 * accidentally copy with quotes). Never logs or returns the raw input
 * in errors.
 *
 * Browser-only. `Keypair.fromSecretKey` runs the public-key derivation
 * locally via tweetnacl; no network request.
 */
export function parseSolanaSecretKey(input: string): ParseKeyResult {
  const trimmed = input.trim().replace(/^["']|["']$/g, "");
  if (!trimmed) {
    return {
      ok: false,
      error: "empty",
      reason: "Paste your secret key to continue.",
    };
  }

  // JSON detection — must start with `[` (after trim). Some wallets
  // pretty-print across lines; JSON.parse handles that.
  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return {
        ok: false,
        error: "invalid-json",
        reason:
          "Looks like a JSON array but couldn't parse it. Check for a stray comma or quote.",
      };
    }
    if (!Array.isArray(parsed)) {
      return {
        ok: false,
        error: "invalid-json",
        reason: "Expected a flat array of numbers like [1, 2, 3, …, 64].",
      };
    }
    if (parsed.length !== 64) {
      return {
        ok: false,
        error: "invalid-length",
        reason: `Expected 64 bytes, got ${parsed.length}. Solana CLI exports a 64-byte secret key.`,
      };
    }
    if (
      !parsed.every(
        (n) =>
          typeof n === "number" &&
          Number.isInteger(n) &&
          n >= 0 &&
          n <= 255,
      )
    ) {
      return {
        ok: false,
        error: "invalid-json",
        reason:
          "Array contains values that aren't byte-sized integers (0-255).",
      };
    }
    const bytes = Uint8Array.from(parsed as number[]);
    return buildKeypairResult(bytes, "json");
  }

  // Base58 path. Phantom / Solflare emit ~88 chars; we don't enforce a
  // length on the encoded string (encoding length depends on the
  // bytes), only on the decoded length below.
  let decoded: Uint8Array;
  try {
    decoded = bs58.decode(trimmed);
  } catch {
    return {
      ok: false,
      error: "invalid-base58",
      reason:
        "Couldn't decode as base58. If your wallet exported a JSON array, paste that instead.",
    };
  }
  if (decoded.length !== 64) {
    return {
      ok: false,
      error: "invalid-length",
      reason: `Decoded ${decoded.length} bytes; expected 64. Phantom + Solflare export the full 64-byte secret key.`,
    };
  }
  return buildKeypairResult(decoded, "base58");
}

function buildKeypairResult(
  bytes: Uint8Array,
  format: "base58" | "json",
): ParseKeyResult {
  let keypair: Keypair;
  try {
    keypair = Keypair.fromSecretKey(bytes);
  } catch (e) {
    // Wipe the bytes we just allocated before bailing — they're a
    // valid 64-byte buffer that just doesn't match Ed25519's pubkey
    // derivation. Still secret material; still wipe.
    bytes.fill(0);
    return {
      ok: false,
      error: "invalid-keypair",
      reason:
        e instanceof Error
          ? e.message
          : "Couldn't reconstruct a keypair from those bytes.",
    };
  }
  // The Keypair's `.secretKey` getter returns a fresh copy on each
  // access, so wiping `kp.secretKey` zeros a discarded buffer. To
  // actually scrub memory we need to wipe (a) the source buffer we
  // decoded into and (b) the internal `_keypair.secretKey` Uint8Array
  // that the constructor stashed.
  const wipe = () => {
    try {
      bytes.fill(0);
    } catch {
      /* readonly buffer — best effort */
    }
    try {
      const internal = (
        keypair as unknown as {
          _keypair?: { secretKey?: Uint8Array };
        }
      )._keypair?.secretKey;
      internal?.fill(0);
    } catch {
      /* @solana/web3.js version mismatch — best effort */
    }
  };
  return { ok: true, keypair, format, wipe };
}

/**
 * Mask a base58 address / pubkey for display. Used by the wizard to
 * confirm the parsed key matches the user's expectation without
 * showing the secret material. Always shows first 4 + last 4 chars.
 */
export function maskAddress(s: string): string {
  if (s.length <= 10) return s;
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}
