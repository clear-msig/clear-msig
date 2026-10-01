import { describe, expect, it } from "vitest";
import { integer } from "../envelopeCodec";
import {
  canonicalEnvelopeHash,
  type CanonicalEnvelopeFields,
} from "../generatedEnvelope";
const fields = (): CanonicalEnvelopeFields => ({
  kind: 9,
  network: 7,
  proposal_index: 8n,
  wallet_name: new TextEncoder().encode("Treasury"),
  wallet_id: new Uint8Array(32),
  actor: new Uint8Array(32),
  action_id: new Uint8Array(32),
  nonce: new Uint8Array(32),
  expires_at: 1800000000n,
  approval_required: 2,
  policy_commitment: new Uint8Array(32),
  payload_hash: new Uint8Array(32),
  clear_text_hash: new Uint8Array(32),
});
describe("Rust envelope primitive boundaries", () => {
  it("uses exact unsigned and signed little-endian ranges", () => {
    expect([...integer(-1n, 8, true)]).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    expect([...integer(-(1n << 63n), 8, true)]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 128,
    ]);
    expect([...integer((1n << 64n) - 1n, 8)]).toEqual([
      255, 255, 255, 255, 255, 255, 255, 255,
    ]);
    for (const n of [-1n, 1n << 64n]) expect(() => integer(n, 8)).toThrow();
    for (const n of [-(1n << 63n) - 1n, 1n << 63n])
      expect(() => integer(n, 8, true)).toThrow();
    expect(() => integer(Number.MAX_SAFE_INTEGER + 1, 8)).toThrow();
  });
  it.each([
    "wallet_id",
    "actor",
    "action_id",
    "nonce",
    "policy_commitment",
    "payload_hash",
    "clear_text_hash",
  ] as const)("rejects truncated or oversized %s", (key) => {
    for (const size of [0, 31, 33])
      expect(() =>
        canonicalEnvelopeHash({ ...fields(), [key]: new Uint8Array(size) }),
      ).toThrow();
  });
  it("rejects invalid protocol enum, threshold and text rather than truncating", () => {
    for (const patch of [
      { kind: 257 },
      { network: 0 },
      { approval_required: 0 },
      { approval_required: 17 },
      { approval_required: 1.5 },
      { wallet_name: new Uint8Array() },
      { wallet_name: new Uint8Array(65).fill(65) },
      { wallet_name: new TextEncoder().encode("Team\n") },
      { proposal_index: -1n },
    ]) {
      expect(() => canonicalEnvelopeHash({ ...fields(), ...patch })).toThrow();
    }
  });
});
