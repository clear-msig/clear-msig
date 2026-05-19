import { describe, expect, it } from "vitest";
import { parseIntent } from "../accounts";

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

function address(byte: number): number[] {
  return new Array(32).fill(byte);
}

function vec(bytes: number[]): number[] {
  return [...u32(bytes.length), ...bytes];
}

function addressVec(addresses: number[][]): number[] {
  return [...u32(addresses.length), ...addresses.flat()];
}

function intentPrefix(): number[] {
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
    ...vec([]),
    ...vec([]),
    ...vec([]),
    ...vec([]),
    ...vec([]),
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
});
