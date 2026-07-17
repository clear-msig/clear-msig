// SHA-256 and Keccak-256 wrappers . thin Uint8Array-returning facades
// over @noble/hashes so the rest of the msig library stays free of the
// vendor-specific API shape.
//
// Both mirror what the on-chain program computes:
//   - sha256 is used for AddIntent / UpdateIntent definition_hash
//     (programs/clear-wallet/src/utils/hash.rs::sha256).
//   - keccak256 is used by chain preimage builders; not needed for the
//     signable message path but exported here for future chain metadata
//     computations the UI may need.
//
// Both functions accept any ArrayBuffer-like input and always return a
// fresh `Uint8Array` . never a view into a shared buffer . to eliminate
// aliasing bugs in downstream code.
// Import from the @noble/hashes 1.5+ canonical module paths.
// `/sha256` and `/sha3` are deprecated in favour of the grouped modules.
import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { keccak_256 } from "@noble/hashes/sha3";

export function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(nobleSha256(data));
}

export function keccak256(data: Uint8Array): Uint8Array {
  return new Uint8Array(keccak_256(data));
}

/// Lowercase hex encoding. Mirror of on-chain `push_hex` . the builder
/// writes pairs of chars from the byte-pool alphabet `"0123456789abcdef"`.
/// Critical that this match byte-for-byte; the signed message contains
/// `definition_hash: <hex>` and any case / encoding mismatch breaks
/// signature verification.
export function toHex(bytes: Uint8Array): string {
  const HEX = "0123456789abcdef";
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX[(b >> 4) & 0xf] + HEX[b & 0xf];
  }
  return out;
}

/// Parse a hex string with optional `0x` prefix, accepting any case.
/// Throws on odd length or non-hex characters.
export function fromHex(input: string): Uint8Array {
  let s = input.trim();
  if (s.startsWith("0x") || s.startsWith("0X")) s = s.slice(2);
  if (s.length % 2 !== 0) {
    throw new Error(`fromHex: odd length (${s.length})`);
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    const hi = parseHexDigit(s.charCodeAt(i * 2));
    const lo = parseHexDigit(s.charCodeAt(i * 2 + 1));
    out[i] = (hi << 4) | lo;
  }
  return out;
}

function parseHexDigit(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30; // 0-9
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10; // a-f
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10; // A-F
  throw new Error(`fromHex: invalid hex digit 0x${c.toString(16)}`);
}
