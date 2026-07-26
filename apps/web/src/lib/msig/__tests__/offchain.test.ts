import { describe, it, expect } from "vitest";
import {
  wrapOffchain,
  unwrapOffchain,
  OFFCHAIN_DOMAIN,
  OFFCHAIN_HEADER_LEN,
} from "@/lib/msig/offchain";

describe("wrapOffchain", () => {
  it("produces a 20-byte header + body", () => {
    const body = new TextEncoder().encode("hello");
    const wrapped = wrapOffchain(body);
    expect(wrapped.length).toBe(OFFCHAIN_HEADER_LEN + body.length);
    // Domain prefix bytes match exactly.
    for (let i = 0; i < OFFCHAIN_DOMAIN.length; i++) {
      expect(wrapped[i]).toBe(OFFCHAIN_DOMAIN[i]);
    }
    // version / format / length little-endian.
    expect(wrapped[16]).toBe(0);
    expect(wrapped[17]).toBe(0);
    expect(wrapped[18]).toBe(body.length & 0xff);
    expect(wrapped[19]).toBe((body.length >> 8) & 0xff);
    // Body payload at offset 20.
    expect(wrapped[20]).toBe("h".charCodeAt(0));
    expect(wrapped[24]).toBe("o".charCodeAt(0));
  });

  it("round-trips through unwrap", () => {
    const body = new TextEncoder().encode(
      "expires 2030-03-17 17:46:40: approve remove intent 3 | wallet: t proposal: 42"
    );
    const back = unwrapOffchain(wrapOffchain(body));
    expect(Array.from(back)).toEqual(Array.from(body));
  });

  it("rejects bodies larger than u16::MAX", () => {
    const tooBig = new Uint8Array(65536);
    expect(() => wrapOffchain(tooBig)).toThrow(/body too large/);
  });

  it("domain bytes are exactly `\\xffsolana offchain`", () => {
    expect(OFFCHAIN_DOMAIN.length).toBe(16);
    expect(OFFCHAIN_DOMAIN[0]).toBe(0xff);
    // "solana offchain" is ASCII.
    const rest = new TextDecoder().decode(OFFCHAIN_DOMAIN.subarray(1));
    expect(rest).toBe("solana offchain");
  });
});
