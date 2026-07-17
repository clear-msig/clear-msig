"use client";

// Per-device address display preference. Three modes:
//
//   - "abbreviated"  - `0x1234…5678` / `Aabc…XyZ9`. Default. Fits
//                      tight UI without revealing the full string
//                      to anyone glancing at the screen.
//   - "full"         - the entire string. For copy / verify / paste.
//   - "checksum"     - EVM only: EIP-55 mixed-case. For chains that
//                      aren't EVM, falls back to "abbreviated".
//
// Why a per-device preference: legitimate users vary on this. A
// treasurer auditing a tx wants the full string; a phone user
// sharing the screen during a meeting wants abbreviated. We store
// the preference; the helpers below consult it on every call.
//
// Threat model is read-only: this preference doesn't gate any
// signed action. It's purely a display decision.

import { keccak_256 } from "@noble/hashes/sha3";

const STORAGE_KEY = "clear.address-format.v1";

export type AddressFormatMode = "abbreviated" | "full" | "checksum";

export function isAddressFormatMode(x: unknown): x is AddressFormatMode {
  return x === "abbreviated" || x === "full" || x === "checksum";
}

export function getAddressFormat(): AddressFormatMode {
  if (typeof window === "undefined") return "abbreviated";
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return isAddressFormatMode(v) ? v : "abbreviated";
  } catch {
    return "abbreviated";
  }
}

export function setAddressFormat(mode: AddressFormatMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
}

const HEX20_RE = /^0x[0-9a-fA-F]{40}$/;

/// Display an EVM address per the active preference.
///   - abbreviated: 0x1234…5678
///   - full:        0x{40 chars} (lowercase)
///   - checksum:    EIP-55 mixed case
///
/// Always returns the input unchanged when it doesn't look like an
/// EVM address (covers ENS names, base58 strings, etc.).
export function formatEvmAddressForDisplay(address: string): string {
  if (!address) return "";
  if (!HEX20_RE.test(address)) return address;
  switch (getAddressFormat()) {
    case "full":
      return address.toLowerCase();
    case "checksum":
      return toEip55(address);
    case "abbreviated":
    default:
      return shortEip55(address);
  }
}

/// Display a Solana / base58 address per the active preference.
///   - abbreviated: 4chars…4chars
///   - full:        the whole string
///   - checksum:    base58 has no checksum-case form; same as full
export function formatSolanaAddressForDisplay(address: string): string {
  if (!address) return "";
  switch (getAddressFormat()) {
    case "full":
    case "checksum":
      return address;
    case "abbreviated":
    default:
      if (address.length <= 9) return address;
      return `${address.slice(0, 4)}…${address.slice(-4)}`;
  }
}

// ── EIP-55 implementation ────────────────────────────────────────
//
// Spec: https://eips.ethereum.org/EIPS/eip-55
//
//   1. Strip 0x, lowercase to canonical form.
//   2. Compute keccak256 of the lowercase ASCII bytes.
//   3. For each char in the original lowercase address, if the
//      corresponding hex nibble in the hash is >= 8, uppercase
//      the original char.

function toEip55(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, "");
  const enc = new TextEncoder();
  const hash = keccak_256(enc.encode(lower));
  // Render the hash as a hex string so we can look up nibbles by
  // position cheaply.
  const hashHex = Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let out = "0x";
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    if (c >= "a" && c <= "f") {
      out += parseInt(hashHex[i], 16) >= 8 ? c.toUpperCase() : c;
    } else {
      out += c;
    }
  }
  return out;
}

function shortEip55(address: string): string {
  // Use the EIP-55 form even when abbreviated so the visible
  // characters carry their checksum case. Looks identical to the
  // existing 4chars…4chars when no letters in the visible window
  // need uppercase.
  const cs = toEip55(address);
  return `${cs.slice(0, 6)}…${cs.slice(-4)}`;
}
