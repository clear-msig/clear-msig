// Param encoder . browser-side mirror of cli/src/params.rs::encode_params.
//
// Given an IntentAccount (already parsed from on-chain state) and a map
// of param_name → string-form value, produce the exact `params_data`
// byte buffer the CLI would build. That buffer is then:
//   1. Passed as the `--params-data` CLI flag in pre-signed mode.
//   2. Hashed (for AddIntent / UpdateIntent meta-intents) or rendered
//      through the template (for Custom intents) into the message body
//      the user's wallet signs.
//
// This module must stay byte-exact with the Rust encoder . any drift
// produces signatures that refuse to verify on chain.

import bs58 from "bs58";
import { ParamType, type ParamEntry } from "@/lib/msig/definition";
import { fromHex } from "@/lib/msig/hash";

/// Minimal shape this encoder needs from a parsed IntentAccount .
/// defined here rather than importing the full type so we don't
/// introduce a circular dep with accounts.ts.
export interface EncodeParamsContext {
  params: readonly ParamEntry[];
  bytePool: Uint8Array;
}

/// Encode `params_data` bytes for a Custom intent. `kv` keys must match
/// the param names embedded in the intent's byte pool. Missing values
/// throw with a clear error . the browser must validate before calling.
///
/// The output is ready to pass straight into the `--params-data` CLI
/// flag as hex, and is also the input to the template renderer.
export function encodeParams(
  intent: EncodeParamsContext,
  kv: Readonly<Record<string, string>>
): Uint8Array {
  // Resolve param name → declared type, in definition order.
  const chunks: Uint8Array[] = [];
  for (const param of intent.params) {
    const name = new TextDecoder().decode(
      intent.bytePool.subarray(param.nameOffset, param.nameOffset + param.nameLen)
    );
    const value = kv[name];
    if (value === undefined) {
      throw new Error(`encodeParams: missing required param "${name}"`);
    }
    chunks.push(encodeOne(name, param.paramType, value));
  }

  // Warn (don't fail) on extra keys . matches the Rust encoder's
  // eprintln! behaviour. We use console.warn because this is a
  // developer-facing nudge; UI components should do their own
  // validation before calling.
  const declared = new Set(
    intent.params.map((p) =>
      new TextDecoder().decode(
        intent.bytePool.subarray(p.nameOffset, p.nameOffset + p.nameLen)
      )
    )
  );
  for (const key of Object.keys(kv)) {
    if (!declared.has(key)) {
      // eslint-disable-next-line no-console
      console.warn(`encodeParams: unknown param "${key}" (not defined in intent)`);
    }
  }

  return concatBytes(chunks);
}

function encodeOne(name: string, t: ParamType, value: string): Uint8Array {
  switch (t) {
    case ParamType.Address: {
      const bytes = decodeBase58(value, name);
      if (bytes.length !== 32) {
        throw new Error(
          `encodeParams: address "${name}" must be 32 bytes, got ${bytes.length}`
        );
      }
      return bytes;
    }
    case ParamType.U64:
      return u64LeBytes(parseUnsigned(value, name, 64n));
    case ParamType.I64:
      return i64LeBytes(parseSigned(value, name, 64n));
    case ParamType.String: {
      const utf8 = new TextEncoder().encode(value);
      if (utf8.length > 255) {
        throw new Error(
          `encodeParams: string param "${name}" too long (${utf8.length} bytes, max 255)`
        );
      }
      const out = new Uint8Array(1 + utf8.length);
      out[0] = utf8.length;
      out.set(utf8, 1);
      return out;
    }
    case ParamType.Bool:
      if (value === "true" || value === "1") return new Uint8Array([1]);
      if (value === "false" || value === "0") return new Uint8Array([0]);
      throw new Error(
        `encodeParams: bool "${name}" expects true/false/0/1, got "${value}"`
      );
    case ParamType.U8:
      return new Uint8Array([Number(parseUnsigned(value, name, 8n))]);
    case ParamType.U16: {
      const v = Number(parseUnsigned(value, name, 16n));
      return new Uint8Array([v & 0xff, (v >> 8) & 0xff]);
    }
    case ParamType.U32: {
      const v = Number(parseUnsigned(value, name, 32n));
      return new Uint8Array([
        v & 0xff,
        (v >> 8) & 0xff,
        (v >> 16) & 0xff,
        (v >> 24) & 0xff,
      ]);
    }
    case ParamType.U128:
      return u128LeBytes(parseUnsigned(value, name, 128n));
    case ParamType.Bytes20: {
      const bytes = fromHex(value);
      if (bytes.length !== 20) {
        throw new Error(
          `encodeParams: bytes20 "${name}" must be 20 bytes, got ${bytes.length}`
        );
      }
      return bytes;
    }
    case ParamType.Bytes32: {
      const bytes = fromHex(value);
      if (bytes.length !== 32) {
        throw new Error(
          `encodeParams: bytes32 "${name}" must be 32 bytes, got ${bytes.length}`
        );
      }
      return bytes;
    }
    default: {
      const exhaustive: never = t;
      throw new Error(`encodeParams: unknown ParamType ${exhaustive}`);
    }
  }
}

// ── small helpers ─────────────────────────────────────────────────────

function decodeBase58(value: string, field: string): Uint8Array {
  try {
    return bs58.decode(value);
  } catch (e) {
    throw new Error(
      `encodeParams: invalid base58 address "${value}" for ${field}: ${e}`
    );
  }
}

function parseUnsigned(value: string, name: string, bits: bigint): bigint {
  let big: bigint;
  try {
    big = BigInt(value);
  } catch {
    throw new Error(`encodeParams: "${name}" is not a valid integer: "${value}"`);
  }
  if (big < 0n) {
    throw new Error(`encodeParams: "${name}" must be non-negative, got ${big}`);
  }
  const max = (1n << bits) - 1n;
  if (big > max) {
    throw new Error(
      `encodeParams: "${name}" does not fit in u${bits} (max ${max}, got ${big})`
    );
  }
  return big;
}

function parseSigned(value: string, name: string, bits: bigint): bigint {
  let big: bigint;
  try {
    big = BigInt(value);
  } catch {
    throw new Error(`encodeParams: "${name}" is not a valid integer: "${value}"`);
  }
  const min = -(1n << (bits - 1n));
  const max = (1n << (bits - 1n)) - 1n;
  if (big < min || big > max) {
    throw new Error(
      `encodeParams: "${name}" does not fit in i${bits} ([${min}, ${max}], got ${big})`
    );
  }
  return big;
}

function u64LeBytes(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, v, /* littleEndian */ true);
  return out;
}

function i64LeBytes(v: bigint): Uint8Array {
  const out = new Uint8Array(8);
  const dv = new DataView(out.buffer);
  dv.setBigInt64(0, v, /* littleEndian */ true);
  return out;
}

function u128LeBytes(v: bigint): Uint8Array {
  const lo = v & ((1n << 64n) - 1n);
  const hi = v >> 64n;
  const out = new Uint8Array(16);
  const dv = new DataView(out.buffer);
  dv.setBigUint64(0, lo, /* littleEndian */ true);
  dv.setBigUint64(8, hi, /* littleEndian */ true);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
