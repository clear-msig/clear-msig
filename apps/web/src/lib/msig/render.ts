// Template renderer . browser-side mirror of
// programs/clear-wallet/src/utils/message.rs::render_template.
//
// Given an intent's template string (e.g. `"send {2:10^18} ETH to {1}
// (nonce {0})"`) and its params_data bytes, substitute each `{N}` /
// `{N:10^D}` placeholder with the rendered form of that parameter,
// matching the on-chain builder byte-for-byte.
//
// Critical invariant: the bytes this function emits must equal the
// bytes the on-chain `push_*` calls emit. Any drift (whitespace, digit
// count, hex case) means signatures fail verification. Tests in
// __tests__/render.test.ts pin a golden-vector for each code path.

import bs58 from "bs58";
import {
  ParamType,
  paramOffsetAt,
  type ParamEntry,
} from "@/lib/msig/definition";
import { toHex } from "@/lib/msig/hash";

/// Minimal intent shape the renderer needs. Same fields as
/// `EncodeParamsContext` . intentionally decoupled from the full
/// IntentAccount type so other modules can pass a narrow subset.
export interface RenderContext {
  params: readonly ParamEntry[];
  bytePool: Uint8Array;
  /// The template string stored in `byte_pool[template_offset..+template_len]`.
  template: string;
}

/// Render a template into its final UTF-8 byte form. Non-bracket bytes
/// are copied verbatim; `{N}` placeholders expand via the param at
/// index N; `{N:10^D}` scales a u64 by 10^D and trims trailing zeros.
export function renderTemplate(
  ctx: RenderContext,
  paramsData: Uint8Array
): Uint8Array {
  const encoder = new TextEncoder();
  const tplBytes = encoder.encode(ctx.template);
  const chunks: Uint8Array[] = [];

  let i = 0;
  while (i < tplBytes.length) {
    if (tplBytes[i] === 0x7b /* { */) {
      const end = tplBytes.indexOf(0x7d /* } */, i + 1);
      if (end < 0) {
        throw new Error("renderTemplate: unmatched '{' in template");
      }
      const inner = decodeAscii(tplBytes.subarray(i + 1, end));
      const colonAt = inner.indexOf(":");
      const idxStr = colonAt >= 0 ? inner.slice(0, colonAt) : inner;
      const fmt = colonAt >= 0 ? inner.slice(colonAt + 1) : null;
      const idx = parseDecimalNonNegative(idxStr, "param index");
      chunks.push(renderParam(ctx, paramsData, idx, fmt));
      i = end + 1;
    } else {
      chunks.push(tplBytes.subarray(i, i + 1));
      i += 1;
    }
  }

  return concatBytes(chunks);
}

/// String form of `renderTemplate` . the bytes are valid UTF-8 because
/// every branch writes only ASCII or param-supplied UTF-8 that was
/// originally a validated string.
export function renderTemplateToString(
  ctx: RenderContext,
  paramsData: Uint8Array
): string {
  return new TextDecoder().decode(renderTemplate(ctx, paramsData));
}

// ── parameter rendering ───────────────────────────────────────────────

function renderParam(
  ctx: RenderContext,
  paramsData: Uint8Array,
  idx: number,
  fmt: string | null
): Uint8Array {
  const param = ctx.params[idx];
  if (!param) {
    throw new Error(`renderTemplate: param index ${idx} out of bounds`);
  }
  const offset = paramOffsetAt(ctx.params, paramsData, idx);

  const te = new TextEncoder();

  switch (param.paramType) {
    case ParamType.Address: {
      const bytes = paramsData.subarray(offset, offset + 32);
      return te.encode(bs58.encode(bytes));
    }
    case ParamType.U64: {
      const v = readU64Le(paramsData, offset);
      if (fmt !== null) {
        const decimals = parseDecimalSpec(fmt);
        return te.encode(formatDecimalU64(v, decimals));
      }
      return te.encode(v.toString(10));
    }
    case ParamType.I64: {
      const v = readI64Le(paramsData, offset);
      return te.encode(v.toString(10));
    }
    case ParamType.String: {
      const len = paramsData[offset];
      return paramsData.subarray(offset + 1, offset + 1 + len);
    }
    case ParamType.Bool: {
      return te.encode(paramsData[offset] !== 0 ? "true" : "false");
    }
    case ParamType.U8: {
      return te.encode(paramsData[offset].toString(10));
    }
    case ParamType.U16: {
      const v = paramsData[offset] | (paramsData[offset + 1] << 8);
      return te.encode(v.toString(10));
    }
    case ParamType.U32: {
      const v =
        paramsData[offset] |
        (paramsData[offset + 1] << 8) |
        (paramsData[offset + 2] << 16) |
        (paramsData[offset + 3] << 24);
      // `| 0` yields a signed int; normalise with unsigned shift for the
      // decimal print.
      return te.encode((v >>> 0).toString(10));
    }
    case ParamType.U128: {
      return te.encode(readU128Le(paramsData, offset).toString(10));
    }
    case ParamType.Bytes20: {
      return te.encode("0x" + toHex(paramsData.subarray(offset, offset + 20)));
    }
    case ParamType.Bytes32: {
      return te.encode("0x" + toHex(paramsData.subarray(offset, offset + 32)));
    }
    default: {
      const exhaustive: never = param.paramType;
      throw new Error(`renderTemplate: unknown ParamType ${exhaustive}`);
    }
  }
}

// ── decimal-shift formatter ──────────────────────────────────────────
//
// Mirror of on-chain `push_decimal_u64`:
//   - integer part emitted first
//   - if there's a fractional part, append '.' and `decimals` digits
//     (leading-zero padded), then trim trailing zeros
//   - integer-only values have no decimal point at all
// Examples:
//   (1_000_000_000, 9)  → "1"
//   (   100_000_000, 9) → "0.1"
//   ( 100_000_000_000_000, 18) → "0.0001"

function formatDecimalU64(val: bigint, decimals: number): string {
  if (decimals === 0) return val.toString(10);
  let scale = 1n;
  for (let i = 0; i < decimals; i++) scale *= 10n;
  const intPart = val / scale;
  const fracPart = val % scale;
  let out = intPart.toString(10);
  if (fracPart > 0n) {
    // Leading-zero-pad to `decimals` width.
    let frac = fracPart.toString(10);
    if (frac.length < decimals) frac = "0".repeat(decimals - frac.length) + frac;
    // Trim trailing zeros.
    let end = frac.length;
    while (end > 0 && frac.charCodeAt(end - 1) === 0x30 /* '0' */) end--;
    out += "." + frac.slice(0, end);
  }
  return out;
}

function parseDecimalSpec(spec: string): number {
  if (!spec.startsWith("10^")) {
    throw new Error(
      `renderTemplate: invalid format spec "${spec}"; only "10^<digits>" is supported`
    );
  }
  const rest = spec.slice(3);
  const n = parseDecimalNonNegative(rest, "decimal spec exponent");
  if (n > 19) {
    throw new Error(
      `renderTemplate: decimal shift too large (${n}, max 19)`
    );
  }
  return n;
}

function parseDecimalNonNegative(s: string, field: string): number {
  if (s.length === 0) throw new Error(`renderTemplate: empty ${field}`);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) {
      throw new Error(`renderTemplate: non-digit "${s[i]}" in ${field}`);
    }
    n = n * 10 + (c - 0x30);
    if (n > 1e9) throw new Error(`renderTemplate: ${field} too large`);
  }
  return n;
}

// ── small byte-reading helpers (match on-chain little-endian form) ───

function readU64Le(data: Uint8Array, off: number): bigint {
  if (off + 8 > data.length) throw new Error("readU64Le: OOB");
  const dv = new DataView(data.buffer, data.byteOffset + off, 8);
  return dv.getBigUint64(0, /* littleEndian */ true);
}

function readI64Le(data: Uint8Array, off: number): bigint {
  if (off + 8 > data.length) throw new Error("readI64Le: OOB");
  const dv = new DataView(data.buffer, data.byteOffset + off, 8);
  return dv.getBigInt64(0, /* littleEndian */ true);
}

function readU128Le(data: Uint8Array, off: number): bigint {
  if (off + 16 > data.length) throw new Error("readU128Le: OOB");
  const dv = new DataView(data.buffer, data.byteOffset + off, 16);
  const lo = dv.getBigUint64(0, /* littleEndian */ true);
  const hi = dv.getBigUint64(8, /* littleEndian */ true);
  return (hi << 64n) | lo;
}

function decodeAscii(bytes: Uint8Array): string {
  // Templates contain only ASCII inside the `{...}` placeholders; plain
  // ASCII decode is faster than TextDecoder here.
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
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
