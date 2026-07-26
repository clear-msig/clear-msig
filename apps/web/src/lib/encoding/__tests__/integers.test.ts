import { describe, expect, it } from "vitest";
import { u32LeBytes } from "@/lib/encoding/integers";

describe("u32LeBytes", () => {
  it("preserves timelocks larger than one byte", () => {
    expect([...u32LeBytes(86_400)]).toEqual([128, 81, 1, 0]);
  });

  it("rejects values outside the on-chain u32 range", () => {
    expect(() => u32LeBytes(-1)).toThrow(/unsigned 32-bit/);
    expect(() => u32LeBytes(0x1_0000_0000)).toThrow(/unsigned 32-bit/);
  });
});
