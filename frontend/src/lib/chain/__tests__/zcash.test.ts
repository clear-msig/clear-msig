import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { sha256 } from "@noble/hashes/sha2";
import { decodeZcashTransparentAddress } from "@/lib/chain/zcash";

function makeTransparentAddress(version: [number, number], pkh: Uint8Array) {
  const payload = new Uint8Array(22);
  payload.set(version, 0);
  payload.set(pkh, 2);
  const checksum = sha256(sha256(payload)).slice(0, 4);
  const full = new Uint8Array(26);
  full.set(payload, 0);
  full.set(checksum, 22);
  return bs58.encode(full);
}

describe("decodeZcashTransparentAddress", () => {
  it("decodes a mainnet transparent address", () => {
    const pkh = Uint8Array.from({ length: 20 }, (_, i) => i + 1);
    const address = makeTransparentAddress([0x1c, 0xb8], pkh);
    const decoded = decodeZcashTransparentAddress(address);
    expect(decoded?.network).toBe("mainnet");
    expect(Array.from(decoded?.pkh ?? [])).toEqual(Array.from(pkh));
  });

  it("decodes a testnet transparent address", () => {
    const pkh = Uint8Array.from({ length: 20 }, (_, i) => 255 - i);
    const address = makeTransparentAddress([0x1d, 0x25], pkh);
    const decoded = decodeZcashTransparentAddress(address);
    expect(decoded?.network).toBe("testnet");
    expect(Array.from(decoded?.pkh ?? [])).toEqual(Array.from(pkh));
  });

  it("rejects a bad checksum", () => {
    const pkh = Uint8Array.from({ length: 20 }, () => 7);
    const address = makeTransparentAddress([0x1c, 0xb8], pkh);
    expect(
      decodeZcashTransparentAddress(address.slice(0, -1) + "1"),
    ).toBeNull();
  });
});
