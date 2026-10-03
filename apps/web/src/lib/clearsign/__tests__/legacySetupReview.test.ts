import { expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { legacySetupReview } from "../legacySetupReview";
import type { DryRunDescriptor } from "@/lib/api/types";
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const num = (n: number, bytes: number) => { const b = Buffer.alloc(bytes); b.writeUIntLE(n, 0, bytes); return b; };
function fixture() {
  const header = Buffer.concat([key(1).toBuffer(), Buffer.from([0, 7, 3, 1, 1, 2, 1]), num(3600, 4), Buffer.alloc(8), Buffer.alloc(2)]);
  const members = Buffer.concat([num(2, 4), key(2).toBuffer(), key(3).toBuffer()]);
  const body = Buffer.concat([header, members, members, Buffer.alloc(7 * 4)]);
  return { action: "intent_add", wallet_name: "Treasury", wallet_pubkey: key(1).toBase58(), params_data_hex: body.toString("hex"), expiry: 2000000000 } as DryRunDescriptor;
}
it("decodes actual intent body layout into full roster, threshold, timelock and permissions", () => {
  const text = legacySetupReview(fixture(), Uint8Array.of(1, 2));
  expect(text).toContain(key(2).toBase58()); expect(text).toContain(key(3).toBase58());
  expect(text).toContain("Required approvals: 2"); expect(text).toContain("Timelock: 3600 seconds");
  expect(text).toContain("Chain kind: 1"); expect(text).toContain("0102");
  expect(text).toContain("not an independent verifier");
});
it("rejects definitions substituted from another wallet", () => {
  expect(() => legacySetupReview({ ...fixture(), wallet_pubkey: key(9).toBase58() }, new Uint8Array())).toThrow("different wallet");
});
it("blocks unsupported opaque legacy actions", () => {
  expect(() => legacySetupReview({ ...fixture(), action: "proposal_create" }, new Uint8Array())).toThrow("lacks a supported readable");
});
