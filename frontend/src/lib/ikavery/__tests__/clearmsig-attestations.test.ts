import { describe, expect, it } from "vitest";
import {
  decodeAttestationBackup,
  encodeAttestationBackup,
} from "../clearmsig-attestations";

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

describe("attestation backups", () => {
  it("round-trips the backup payload", () => {
    const backup = encodeAttestationBackup("recovery123", {
      attestationData: bytes([1, 2, 3]),
      networkSignature: bytes([4, 5, 6]),
      networkPubkey: bytes([7, 8, 9]),
      publicKey: bytes([10, 11, 12]),
      dwalletAddr: bytes([13, 14, 15]),
    });

    const parsed = decodeAttestationBackup(backup);

    expect(parsed.recoveryPda).toBe("recovery123");
    expect(Array.from(parsed.bundle.attestationData)).toEqual([1, 2, 3]);
    expect(Array.from(parsed.bundle.networkSignature)).toEqual([4, 5, 6]);
    expect(Array.from(parsed.bundle.networkPubkey)).toEqual([7, 8, 9]);
    expect(Array.from(parsed.bundle.publicKey)).toEqual([10, 11, 12]);
    expect(Array.from(parsed.bundle.dwalletAddr ?? new Uint8Array())).toEqual([
      13, 14, 15,
    ]);
  });

  it("rejects an unsupported backup version", () => {
    expect(() =>
      decodeAttestationBackup(
        JSON.stringify({ version: 2, recoveryPda: "x" }),
      ),
    ).toThrow("Unsupported attestation backup format.");
  });
});
