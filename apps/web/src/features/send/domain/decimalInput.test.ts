import { expect, it } from "vitest";
import { acceptsDecimalInput } from "./decimalInput";
it("retains exact smallest-unit decimals and empty editing states", () => {
  for (const value of ["", ".", "0.", "0.000000001", "9007199.254740991"]) expect(acceptsDecimalInput(value, 9, 12)).toBe(true);
  expect(acceptsDecimalInput("0.000000000000000001", 18, 12)).toBe(true);
});
it("does not silently turn an exponent/sign/separator or extra precision into a different amount", () => {
  for (const value of ["1e-9", "-1", "+1", "1,234", "1.2.3", "0.0000000001"]) expect(acceptsDecimalInput(value, 9, 12)).toBe(false);
});
