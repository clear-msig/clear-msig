import { describe, it, expect } from "vitest";
import bs58 from "bs58";
import { ParamType, type ParamEntry } from "@/lib/msig/definition";
import { encodeParams } from "@/lib/msig/encode";
import { fromHex, toHex } from "@/lib/msig/hash";

// Builds a minimal ParamEntry[] + bytePool so the encoder can look up
// names. Each call returns a fresh independent pool.
function makeParams(defs: Array<{ name: string; type: ParamType }>): {
  params: ParamEntry[];
  bytePool: Uint8Array;
} {
  const te = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const params: ParamEntry[] = [];
  let offset = 0;
  for (const def of defs) {
    const name = te.encode(def.name);
    chunks.push(name);
    params.push({
      paramType: def.type,
      nameOffset: offset,
      nameLen: name.length,
      constraintType: 0,
      constraintValue: 0n,
    });
    offset += name.length;
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const pool = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    pool.set(c, off);
    off += c.length;
  }
  return { params, bytePool: pool };
}

describe("encodeParams", () => {
  it("encodes u64 little-endian", () => {
    const ctx = makeParams([{ name: "amount", type: ParamType.U64 }]);
    const bytes = encodeParams(ctx, { amount: "1000000000" });
    // 1_000_000_000 = 0x3B9ACA00 → LE = [0x00,0xCA,0x9A,0x3B,0,0,0,0]
    expect(toHex(bytes)).toBe("00ca9a3b00000000");
  });

  it("encodes i64 preserving sign", () => {
    const ctx = makeParams([{ name: "x", type: ParamType.I64 }]);
    const bytes = encodeParams(ctx, { x: "-1" });
    expect(toHex(bytes)).toBe("ffffffffffffffff");
  });

  it("encodes bytes20 hex (strips 0x)", () => {
    const ctx = makeParams([{ name: "to", type: ParamType.Bytes20 }]);
    const bytes = encodeParams(ctx, {
      to: "0x000000000000000000000000000000000000dEaD",
    });
    expect(bytes.length).toBe(20);
    expect(toHex(bytes)).toBe("000000000000000000000000000000000000dead");
  });

  it("encodes address from base58", () => {
    const zero32 = new Uint8Array(32);
    const b58 = bs58.encode(zero32);
    const ctx = makeParams([{ name: "to", type: ParamType.Address }]);
    const bytes = encodeParams(ctx, { to: b58 });
    expect(bytes.length).toBe(32);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it("encodes string with u8 length prefix", () => {
    const ctx = makeParams([{ name: "data", type: ParamType.String }]);
    const bytes = encodeParams(ctx, { data: "hi" });
    expect(Array.from(bytes)).toEqual([0x02, 0x68, 0x69]);
  });

  it("encodes u128 little-endian across 16 bytes", () => {
    const ctx = makeParams([{ name: "amt", type: ParamType.U128 }]);
    const bytes = encodeParams(ctx, { amt: "1000000" });
    expect(bytes.length).toBe(16);
    // 1_000_000 = 0xF4240 → [0x40, 0x42, 0x0F, 0, ...0]
    expect(toHex(bytes.subarray(0, 4))).toBe("40420f00");
    expect(bytes.subarray(4).every((b) => b === 0)).toBe(true);
  });

  it("encodes bool true as 0x01, false as 0x00", () => {
    const ctx = makeParams([{ name: "flag", type: ParamType.Bool }]);
    expect(Array.from(encodeParams(ctx, { flag: "true" }))).toEqual([1]);
    expect(Array.from(encodeParams(ctx, { flag: "false" }))).toEqual([0]);
    expect(Array.from(encodeParams(ctx, { flag: "1" }))).toEqual([1]);
    expect(Array.from(encodeParams(ctx, { flag: "0" }))).toEqual([0]);
  });

  it("rejects missing param", () => {
    const ctx = makeParams([{ name: "amount", type: ParamType.U64 }]);
    expect(() => encodeParams(ctx, {})).toThrow(/missing required param "amount"/);
  });

  it("rejects out-of-range u8", () => {
    const ctx = makeParams([{ name: "x", type: ParamType.U8 }]);
    expect(() => encodeParams(ctx, { x: "256" })).toThrow(/does not fit in u8/);
  });

  it("concatenates params in definition order", () => {
    const ctx = makeParams([
      { name: "a", type: ParamType.U8 },
      { name: "b", type: ParamType.U16 },
      { name: "c", type: ParamType.U32 },
    ]);
    const bytes = encodeParams(ctx, { a: "1", b: "2", c: "3" });
    // [01] [02 00] [03 00 00 00] = 7 bytes
    expect(toHex(bytes)).toBe("01020003000000");
  });
});
