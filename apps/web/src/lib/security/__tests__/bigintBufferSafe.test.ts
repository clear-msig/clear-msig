import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { u64 } from "@solana/buffer-layout-utils";
import {
  toBigIntBE,
  toBigIntLE,
  toBufferBE,
  toBufferLE,
} from "bigint-buffer";

describe("audited bigint-buffer replacement", () => {
  it.each([0n, 1n, 255n, 256n, 65_535n, 18_446_744_073_709_551_615n])(
    "round-trips unsigned fixed-width value %s",
    (value) => {
      expect(toBigIntLE(toBufferLE(value, 8))).toBe(value);
      expect(toBigIntBE(toBufferBE(value, 8))).toBe(value);
    },
  );

  it("rejects truncation, negative values, and invalid widths", () => {
    expect(() => toBufferLE(256n, 1)).toThrow(RangeError);
    expect(() => toBufferBE(-1n, 8)).toThrow(TypeError);
    expect(() => toBufferBE(1n, -1)).toThrow(RangeError);
    expect(() => toBufferBE(1n, Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });

  it("round-trips through Solana's installed u64 layout", () => {
    const layout = u64("amount");
    const encoded = Buffer.alloc(8);
    const amount = 9_007_199_254_740_993n;
    expect(layout.encode(amount, encoded, 0)).toBe(8);
    expect(layout.decode(encoded)).toBe(amount);
  });

  it("contains no native binding or unsafe allocation path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "vendor/bigint-buffer-safe/index.js"),
      "utf8",
    );
    expect(source).not.toContain("bindings");
    expect(source).not.toContain("allocUnsafe");
    expect(source).not.toContain("node-gyp");
  });
});
