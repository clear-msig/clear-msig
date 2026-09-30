import { describe, expect, it } from "vitest";
import { wholeToMinor, rampTargetForChainKind } from "../chains";

describe("exact ramp asset amounts", () => {
  it("preserves smallest units without Number rounding", () => {
    expect(wholeToMinor("0.000000001", 1_000_000_000n, 4)).toBe(1n);
    expect(wholeToMinor("1.123456789123456789", 10n ** 18n, 6)).toBe(1_123_456_789_123_456_789n);
  });
  it.each(["0.0000000001", "-1", "1e3", "1,000", "1.2.3", "9".repeat(1000)])("rejects invalid or lossy input %s", (amount) => {
    expect(wholeToMinor(amount, 1_000_000_000n, 4)).toBeNull();
  });
  it("rejects unsupported scales and settlement assets", () => {
    expect(wholeToMinor("1", 0n, 4)).toBeNull();
    expect(wholeToMinor("1", 12n, 4)).toBeNull();
    expect(rampTargetForChainKind(4)).toBeNull();
    expect(rampTargetForChainKind(5)).toBeNull();
    expect(rampTargetForChainKind(0)?.asset_symbol).toBe("SOL");
  });
});
