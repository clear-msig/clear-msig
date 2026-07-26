import { describe, expect, it } from "vitest";
import { deriveNativeWeeklyCaps } from "@/lib/policies/budgetLimits";

describe("deriveNativeWeeklyCaps", () => {
  it("uses the stricter wallet or chain cap and preserves native precision", () => {
    const caps = deriveNativeWeeklyCaps(
      1_000,
      { BTC: 500, ZEC: 2_000 },
      (ticker) => (ticker === "BTC" ? 100_000 : ticker === "ZEC" ? 50 : 100),
    );

    expect(caps.BTC).toBe("0.005");
    expect(caps.ZEC).toBe("20");
  });

  it("does not create an unenforceable cap without a price", () => {
    const caps = deriveNativeWeeklyCaps(1_000, {}, () => null);
    expect(caps.BTC).toBeNull();
    expect(caps.ZEC).toBeNull();
  });
});
