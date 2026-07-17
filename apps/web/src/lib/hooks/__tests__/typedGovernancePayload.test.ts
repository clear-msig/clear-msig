import { describe, expect, it } from "vitest";
import {
  decodeTypedGovernancePayload,
  encodeTypedGovernancePayload,
  typedGovernanceCommitmentHex,
} from "@/lib/hooks/typedGovernancePayload";

describe("typed governance execution payload", () => {
  it("round-trips the target intent and exact replacement body", () => {
    const encoded = encodeTypedGovernancePayload(7, "0200aaff");

    expect(encoded.hex).toBe("070200aaff");
    expect(decodeTypedGovernancePayload(encoded.hex)).toEqual({
      targetIntentIndex: 7,
      newIntentBodyHex: "0200aaff",
    });
    expect(typedGovernanceCommitmentHex(encoded.bytes)).toBe(
      "75e75fde8f9e3e3709545c104b34bf92ee4dffa3bb2af9d323362340b86e531f",
    );
  });

  it("rejects an empty or malformed committed payload", () => {
    expect(() => decodeTypedGovernancePayload("07")).toThrow(
      "missing its committed execution payload",
    );
    expect(() => encodeTypedGovernancePayload(256, "aa")).toThrow(
      "target intent index is invalid",
    );
  });
});
