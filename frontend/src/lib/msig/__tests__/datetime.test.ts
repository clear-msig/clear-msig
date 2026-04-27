import { describe, it, expect } from "vitest";
import { formatTimestamp, formatTimestampBytes } from "@/lib/msig/datetime";

// Golden vectors derived directly from the on-chain
// `format_timestamp` algorithm. These MUST match the Rust output
// byte-for-byte; any drift breaks signature verification because the
// timestamp is embedded in the signed message body.

describe("formatTimestamp", () => {
  it("unix epoch renders as 1970-01-01 00:00:00", () => {
    expect(formatTimestamp(0)).toBe("1970-01-01 00:00:00");
  });

  it("classic test timestamp 1_000_000_000 → 2001-09-09 01:46:40", () => {
    expect(formatTimestamp(1_000_000_000)).toBe("2001-09-09 01:46:40");
  });

  it("e2e DEFAULT_EXPIRY 1_900_000_000 → 2030-03-17 17:46:40", () => {
    // The e2e binary pins `DEFAULT_EXPIRY = 1_900_000_000`; verifying
    // this value here means every e2e proposal we generate off-chain
    // will hash the same timestamp the program's builder does.
    expect(formatTimestamp(1_900_000_000)).toBe("2030-03-17 17:46:40");
  });

  it("one second before epoch → 1969-12-31 23:59:59", () => {
    expect(formatTimestamp(-1)).toBe("1969-12-31 23:59:59");
  });

  it("bigint input works identically", () => {
    expect(formatTimestamp(1_000_000_000n)).toBe("2001-09-09 01:46:40");
  });

  it("byte form has length 19 and matches string form", () => {
    const bytes = formatTimestampBytes(1_000_000_000);
    expect(bytes.length).toBe(19);
    expect(new TextDecoder().decode(bytes)).toBe("2001-09-09 01:46:40");
  });
});
