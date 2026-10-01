import { describe, expect, it } from "vitest";
import { validateRecordedEscrowAmounts } from "./escrowRecord";
describe("recorded escrow amount bounds", () => {
  it("compares integers beyond Number's exact range without rounding", () => {
    expect(() =>
      validateRecordedEscrowAmounts("9007199254740992", "9007199254740993", 0),
    ).toThrow("exceeds");
    expect(() =>
      validateRecordedEscrowAmounts("9007199254740993", "9007199254740992", 0),
    ).not.toThrow();
  });
  it("compares full precision and rejects fractional overfunding", () => {
    expect(() =>
      validateRecordedEscrowAmounts(
        "1.000000000000000001",
        "1.000000000000000002",
        18,
      ),
    ).toThrow("exceeds");
    expect(() =>
      validateRecordedEscrowAmounts("1.000000001", "1.000000001", 9),
    ).not.toThrow();
  });
  it.each(["0", "-1", "1e3", "NaN", "0.0000000001"])(
    "rejects invalid or excessive-precision SOL record %s",
    (value) => {
      expect(() => validateRecordedEscrowAmounts(value, "1", 9)).toThrow();
    },
  );
});
