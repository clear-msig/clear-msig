import { describe, expect, it } from "vitest";
import {
  formatUnixSigningExpiry,
  freshSigningExpiry,
  normalizeSigningExpiry,
  withFreshExpiry,
} from "@/lib/api/expiry";

describe("freshSigningExpiry", () => {
  it("formats a UTC CLI-compatible expiry 30 minutes ahead by default", () => {
    expect(freshSigningExpiry(Date.UTC(2026, 4, 29, 0, 6, 15))).toBe(
      "2026-05-29 00:36:15",
    );
  });

  it("preserves explicit caller expiry", () => {
    expect(withFreshExpiry({ expiry: "2030-01-01 00:00:00", params: [] })).toEqual({
      expiry: "2030-01-01 00:00:00",
      params: [],
    });
  });

  it("formats Unix-second expiry values from typed ClearSign envelopes", () => {
    expect(formatUnixSigningExpiry(1_783_426_450)).toBe(
      "2026-07-07 12:14:10",
    );
    expect(normalizeSigningExpiry("1783426450")).toBe(
      "2026-07-07 12:14:10",
    );
    expect(withFreshExpiry({ expiry: "1783426450", params: [] })).toEqual({
      expiry: "2026-07-07 12:14:10",
      params: [],
    });
  });

  it("adds expiry without mutating the original input", () => {
    const input = { params: ["amount=1"] };
    const out = withFreshExpiry(input);

    expect(input).toEqual({ params: ["amount=1"] });
    expect(out).toMatchObject({ params: ["amount=1"] });
    expect(out.expiry).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
