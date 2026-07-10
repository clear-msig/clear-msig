import { describe, expect, it } from "vitest";
import {
  assertPreparedBitcoinSetupIsCurrent,
  bytesToHex,
  normalizeBitcoinPolicyRecipient,
} from "@/features/send/domain/bitcoin";

describe("bitcoin send domain", () => {
  it("canonicalizes a P2WPKH recipient to its committed hash", () => {
    expect(
      normalizeBitcoinPolicyRecipient("BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4"),
    ).toBe("btc-p2wpkh:0x751e76e8199196d454941c45d1b3a323f1433bd6");
  });

  it("trims recipients that are not supported P2WPKH addresses", () => {
    expect(normalizeBitcoinPolicyRecipient("  unsupported-address  ")).toBe(
      "unsupported-address",
    );
  });

  it("encodes bytes without losing leading zeroes", () => {
    expect(bytesToHex(new Uint8Array([0, 1, 15, 255]))).toBe("00010fff");
  });

  it("fails closed when prepared intent data cannot be decoded", () => {
    expect(() => assertPreparedBitcoinSetupIsCurrent("00")).toThrow(
      "Bitcoin sending could not be prepared",
    );
  });
});
