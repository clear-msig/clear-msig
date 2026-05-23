import { PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import {
  loadAttestationVerified,
  decodeAttestationBackup,
  encodeAttestationBackup,
  saveAttestation,
} from "../clearmsig-attestations";
import { DISC_RECOVERY } from "../constants";

function bytes(values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function makeLocalStorageStub() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    clear: () => store.clear(),
  };
}

function buildRecoveryData(dwallet: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + 32 + 32 + 32 + 2 + 2 + 2 + 4 + 4 + 4 + 2);
  let off = 0;
  out[off++] = DISC_RECOVERY;
  out.set(new Uint8Array(32).fill(1), off);
  off += 32;
  out.set(new Uint8Array(32).fill(2), off);
  off += 32;
  out.set(dwallet, off);
  off += 32;
  const dv = new DataView(out.buffer);
  dv.setUint16(off, 2, true);
  off += 2;
  dv.setUint16(off, 1, true);
  off += 2;
  dv.setUint16(off, 0, true);
  off += 2;
  dv.setUint32(off, 0, true);
  off += 4;
  dv.setUint32(off, 0, true);
  off += 4;
  dv.setUint32(off, 0, true);
  off += 4;
  dv.setUint16(off, 0, true);
  return out;
}

function mockConnection(dwallet: Uint8Array) {
  return {
    getAccountInfo: vi.fn(async () => ({
      data: Buffer.from(buildRecoveryData(dwallet)),
    })),
  } as never;
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

  it("fails fast on a fresh browser with no cached attestation", async () => {
    const localStorage = makeLocalStorageStub();
    vi.stubGlobal("window", { localStorage } as never);
    try {
      const recovery = new PublicKey(new Uint8Array(32).fill(1));
      await expect(
        loadAttestationVerified(
          mockConnection(new Uint8Array(32).fill(7)),
          recovery,
        ),
      ).rejects.toThrow("No DKG attestation for this vault on this device");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("rejects stale localStorage with a mismatched dwallet", async () => {
    const localStorage = makeLocalStorageStub();
    vi.stubGlobal("window", { localStorage } as never);
    try {
      const recovery = new PublicKey(new Uint8Array(32).fill(1));
      const onChain = new Uint8Array(32).fill(8);
      const stored = new Uint8Array(32).fill(9);
      saveAttestation(recovery.toBase58(), {
        attestationData: bytes([1]),
        networkSignature: bytes([2]),
        networkPubkey: bytes([3]),
        publicKey: stored,
        dwalletAddr: bytes([4]),
      });
      await expect(
        loadAttestationVerified(mockConnection(onChain), recovery),
      ).rejects.toThrow("doesn't match the on-chain Recovery");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
