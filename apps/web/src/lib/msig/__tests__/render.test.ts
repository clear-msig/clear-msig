import { describe, it, expect } from "vitest";
import bs58 from "bs58";
import {
  ParamType,
  type ParamEntry,
} from "@/lib/msig/definition";
import {
  renderTemplate,
  renderTemplateToString,
} from "@/lib/msig/render";

function ctx(template: string, params: ParamEntry[]): {
  params: ParamEntry[];
  bytePool: Uint8Array;
  template: string;
} {
  return { params, bytePool: new Uint8Array(), template };
}

function param(t: ParamType): ParamEntry {
  return {
    paramType: t,
    nameOffset: 0,
    nameLen: 0,
    constraintType: 0,
    constraintValue: 0n,
  };
}

describe("renderTemplate", () => {
  it("substitutes {N} with a base58 address", () => {
    const addr = new Uint8Array(32);
    addr.fill(0xab);
    // paramsData = 32-byte address
    const s = renderTemplateToString(
      ctx("to: {0}", [param(ParamType.Address)]),
      addr
    );
    expect(s).toBe(`to: ${bs58.encode(addr)}`);
  });

  it("substitutes {N} with a u64 decimal integer", () => {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, 1_000_000_000n, true);
    const s = renderTemplateToString(
      ctx("amt: {0}", [param(ParamType.U64)]),
      data
    );
    expect(s).toBe("amt: 1000000000");
  });

  it("applies {N:10^18} decimal shift and trims zeros", () => {
    const data = new Uint8Array(8);
    // value_wei = 100_000_000_000_000 → 0.0001 ETH
    new DataView(data.buffer).setBigUint64(0, 100_000_000_000_000n, true);
    const s = renderTemplateToString(
      ctx("{0:10^18} ETH", [param(ParamType.U64)]),
      data
    );
    expect(s).toBe("0.0001 ETH");
  });

  it("integer-only values shift without decimal point", () => {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, 1_000_000_000n, true);
    const s = renderTemplateToString(
      ctx("{0:10^9}", [param(ParamType.U64)]),
      data
    );
    expect(s).toBe("1");
  });

  it("substitutes bytes20 with 0x-prefixed lowercase hex", () => {
    const data = new Uint8Array(20);
    data[data.length - 1] = 0xad;
    data[data.length - 2] = 0xde;
    const s = renderTemplateToString(
      ctx("to 0x{0}", [param(ParamType.Bytes20)]),
      data
    );
    // NB: on-chain renderer emits `0x` + hex of full 20 bytes; the
    // template already has "0x" baked in for our common case, so the
    // param itself also emits "0x...". Duplicate-prefix quirks are a
    // template-author concern.
    expect(s).toBe(
      "to 0x0x000000000000000000000000000000000000dead"
    );
  });

  it("substitutes multiple params in one template", () => {
    const nonce = new Uint8Array(8);
    new DataView(nonce.buffer).setBigUint64(0, 42n, true);
    const to = new Uint8Array(20);
    to[19] = 0xad;
    to[18] = 0xde;
    const wei = new Uint8Array(8);
    new DataView(wei.buffer).setBigUint64(0, 100_000_000_000_000n, true);
    const bytes = new Uint8Array(nonce.length + to.length + wei.length);
    bytes.set(nonce, 0);
    bytes.set(to, 8);
    bytes.set(wei, 28);
    const s = renderTemplateToString(
      ctx("send {2:10^18} ETH to {1} (nonce {0})", [
        param(ParamType.U64),
        param(ParamType.Bytes20),
        param(ParamType.U64),
      ]),
      bytes
    );
    expect(s).toBe("send 0.0001 ETH to 0x000000000000000000000000000000000000dead (nonce 42)");
  });

  it("returns Uint8Array equal to TextEncoder.encode of string form", () => {
    const data = new Uint8Array(8);
    new DataView(data.buffer).setBigUint64(0, 7n, true);
    const expected = new TextEncoder().encode("seven: 7");
    const actual = renderTemplate(
      ctx("seven: {0}", [param(ParamType.U64)]),
      data
    );
    expect(Array.from(actual)).toEqual(Array.from(expected));
  });

  it("rejects unmatched '{'", () => {
    expect(() =>
      renderTemplateToString(ctx("{0", [param(ParamType.U64)]), new Uint8Array(8))
    ).toThrow(/unmatched/);
  });
});
