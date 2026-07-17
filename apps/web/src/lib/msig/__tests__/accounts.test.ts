import { describe, expect, it } from "vitest";
import { parseAnyProposal, parseIntent, parseTypedProposal } from "../accounts";
import bs58 from "bs58";

function u16(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff];
}

function u32(value: number): number[] {
  return [
    value & 0xff,
    (value >> 8) & 0xff,
    (value >> 16) & 0xff,
    (value >> 24) & 0xff,
  ];
}

function u64(value: bigint): number[] {
  const out = new Array(8).fill(0);
  let remaining = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function i64(value: bigint): number[] {
  return u64(BigInt.asUintN(64, value));
}

function address(byte: number): number[] {
  return new Array(32).fill(byte);
}

function vec(bytes: number[]): number[] {
  return [...u32(bytes.length), ...bytes];
}

function rawVec(count: number, bytes: number[]): number[] {
  return [...u32(count), ...bytes];
}

function paramEntry(nameOffset: number, nameLen: number): number[] {
  return [
    1, // ParamType.U64
    ...u16(nameOffset),
    ...u16(nameLen),
    0, // ConstraintType.None
    0, 0, 0, 0, 0, 0, 0, 0, // constraint_value
  ];
}

function addressVec(addresses: number[][]): number[] {
  return [...u32(addresses.length), ...addresses.flat()];
}

function intentPrefix(params: number[] = []): number[] {
  return [
    2,
    ...address(1),
    255,
    0,
    0,
    0,
    1,
    1,
    1,
    ...u32(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...u16(0),
    ...addressVec([address(2)]),
    ...addressVec([address(3)]),
    ...rawVec(params.length / 14, params),
    ...rawVec(0, []),
    ...rawVec(0, []),
    ...rawVec(0, []),
    ...rawVec(0, []),
  ];
}

describe("parseIntent", () => {
  it("accepts legacy intent accounts without policy_ciphertexts tail", () => {
    const parsed = parseIntent(new Uint8Array(intentPrefix()));

    expect(parsed.policyCiphertexts).toHaveLength(0);
    expect(parsed.policyCiphertextIds).toEqual([]);
    expect(parsed.bytePool).toHaveLength(0);
  });

  it("parses policy ciphertext ids from current intent accounts", () => {
    const id = "ct_0123456789abcdef";
    const encodedIds = [
      ...u16(1),
      ...u16(id.length),
      ...new TextEncoder().encode(id),
    ];
    const parsed = parseIntent(
      new Uint8Array([...intentPrefix(), ...vec(encodedIds), ...vec([])]),
    );

    expect(parsed.policyCiphertextIds).toEqual([id]);
  });

  it("rejects param names outside the byte pool", () => {
    expect(() =>
      parseIntent(new Uint8Array([...intentPrefix(paramEntry(0, 1)), ...vec([]), ...vec([])])),
    ).toThrow(/param\[0\]\.name range/);
  });
});

describe("parseTypedProposal", () => {
  it("parses the v2 typed proposal account layout", () => {
    const actionId = Array.from(new TextEncoder().encode("release-escrow-1"));
    const nonce = Array.from(new TextEncoder().encode("nonce-1"));
    const data = new Uint8Array([
      6,
      ...address(1),
      ...address(2),
      ...u64(42n),
      ...address(3),
      0, // Active
      8, // ReturnEscrowFunds
      ...i64(1_800_000_001n),
      ...i64(1_800_000_002n),
      ...i64(1_800_000_600n),
      254,
      ...u16(0b0011),
      ...u16(0b0100),
      ...address(4),
      ...address(9),
      ...address(10),
      ...address(11),
      ...vec(actionId),
      ...vec(nonce),
    ]);

    const parsed = parseTypedProposal(data);

    expect(parsed.typed).toBe(true);
    expect(parsed.wallet).toBe(bs58.encode(new Uint8Array(address(1))));
    expect(parsed.intent).toBe(bs58.encode(new Uint8Array(address(2))));
    expect(parsed.proposalIndex).toBe(42n);
    expect(parsed.proposer).toBe(bs58.encode(new Uint8Array(address(3))));
    expect(parsed.statusLabel).toBe("Active");
    expect(parsed.actionKind).toBe(8);
    expect(parsed.proposedAt).toBe(1_800_000_001n);
    expect(parsed.approvedAt).toBe(1_800_000_002n);
    expect(parsed.expiresAt).toBe(1_800_000_600n);
    expect(parsed.approvalBitmap).toBe(0b0011);
    expect(parsed.cancellationBitmap).toBe(0b0100);
    expect(parsed.policyCommitment).toBe("09".repeat(32));
    expect(parsed.payloadHash).toBe("0a".repeat(32));
    expect(parsed.envelopeHash).toBe("0b".repeat(32));
    expect(parsed.actionId).toBe("release-escrow-1");
    expect(parsed.nonce).toBe("nonce-1");
  });

  it("parseAnyProposal dispatches typed proposal accounts", () => {
    const data = new Uint8Array([
      6,
      ...address(1),
      ...address(2),
      ...u64(7n),
      ...address(3),
      1,
      7,
      ...i64(1n),
      ...i64(2n),
      ...i64(3n),
      255,
      ...u16(1),
      ...u16(0),
      ...address(4),
      ...address(9),
      ...address(10),
      ...address(11),
      ...vec([65]),
      ...vec([66]),
    ]);

    expect(parseAnyProposal(data).typed).toBe(true);
  });
});
