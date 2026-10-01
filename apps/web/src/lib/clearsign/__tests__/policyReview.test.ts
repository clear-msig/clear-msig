import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { toHex } from "@/lib/msig/hash";
import { policyCommitmentHex } from "@/lib/policies/onchain";
import { reviewStoredProtectionPolicy } from "../policyReview";
const key = (n: number) => new PublicKey(new Uint8Array(32).fill(n));
const uint = (value: bigint | number, size: number) => {
  const b = new Uint8Array(size);
  let n = BigInt(value);
  for (let i = 0; i < size; i++) {
    b[i] = Number(n & 255n);
    n >>= 8n;
  }
  return b;
};
const concat = (...rows: Uint8Array[]) =>
  new Uint8Array(rows.flatMap((b) => [...b]));
const base = (mode = 0, recipients: number[] = [], approvers: number[] = []) =>
  concat(
    new TextEncoder().encode("CSP1"),
    new Uint8Array([mode]),
    uint(1000000001n, 8),
    uint(30, 4),
    new Uint8Array([recipients.length, approvers.length]),
    ...recipients.map((n) => key(n).toBytes()),
    ...approvers.map((n) => key(n).toBytes()),
  );
const ext = (tag: number, bytes: Uint8Array) =>
  concat(new Uint8Array([tag]), uint(bytes.length, 2), bytes);
const scope = (bytes: Uint8Array) =>
  concat(
    new TextEncoder().encode("CSP2"),
    new Uint8Array([1, 6]),
    key(4).toBytes(),
    bytes,
  );
const details = (bytes: Uint8Array, asset = false) =>
  `${asset ? `Asset: USDC\nAsset mint: ${key(4)}\nDecimals: 6\nPolicy scope: SPL token` : "Policy chain kind: 0"}\nNew policy commitment: ${policyCommitmentHex(bytes)}`;
const review = (bytes: Uint8Array, asset = false, override?: string) =>
  reviewStoredProtectionPolicy(
    asset ? 16 : 6,
    toHex(bytes),
    override ?? details(bytes, asset),
  );
describe("committed protection policy review — byte fixtures, no transactions", () => {
  it("renders exact SOL units, full recipient/member identities and delay", () => {
    const text = review(base(1, [2], [3]));
    for (const required of [
      "1.000000001 SOL (1000000001 raw units)",
      key(2).toBase58(),
      key(3).toBase58(),
      "30 seconds",
      "Only the following",
    ])
      expect(text).toContain(required);
  });
  it("distinguishes unlimited from a zero allowance and deny-all from any recipient", () => {
    const b = base(1);
    b.fill(0, 5, 13);
    expect(review(b)).toContain("No amount cap");
    expect(review(b)).toContain("all transfers blocked");
    expect(review(base(0))).toContain("Recipients: Any recipient");
    expect(review(base(2))).toContain("empty blocklist");
  });
  it("shows all supported velocity/count/time/member rules and the program's offset convention", () => {
    const b = concat(
      base(),
      ext(1, concat(uint(2000000000n, 8), uint(3600, 4))),
      ext(2, concat(uint(3, 4), uint(7200, 4))),
      ext(3, concat(new Uint8Array([22, 6, 2]), uint(300, 2))),
      ext(4, concat(key(7).toBytes(), uint(900000000n, 8), uint(86400, 4))),
    );
    const text = review(b);
    for (const required of [
      "2 SOL",
      "3600-second",
      "3 per 7200-second",
      "22:00 inclusive to 06:00 exclusive (overnight)",
      "UTC-05:00",
      "Monday",
      key(7).toBase58(),
      "0.9 SOL",
      "86400-second",
    ])
      expect(text).toContain(required);
  });
  it("identifies equal time boundaries as no hours and zero mask as every day", () => {
    expect(
      review(concat(base(), ext(3, new Uint8Array([9, 9, 0, 0, 0])))),
    ).toContain("No hours allowed");
    expect(
      review(concat(base(), ext(3, new Uint8Array([9, 17, 0, 0, 0])))),
    ).toContain("Every day");
  });
  it("binds SPL mint/decimals and uses exact asset units", () => {
    const bytes = scope(base());
    const text = review(bytes, true);
    expect(text).toContain(key(4).toBase58());
    expect(text).toContain("1000.000001 USDC");
    expect(() =>
      review(
        bytes,
        true,
        details(bytes, true).replace("Decimals: 6", "Decimals: 9"),
      ),
    ).toThrow(/differs/);
    expect(() =>
      review(
        bytes,
        true,
        details(bytes, true).replace(key(4).toBase58(), key(8).toBase58()),
      ),
    ).toThrow(/differs/);
  });
  it("rejects mutated bytes without granting authority to their opaque hash", () => {
    const bytes = base(),
      doc = details(bytes);
    bytes[5] ^= 1;
    expect(() => review(bytes, false, doc)).toThrow(/commitment/);
  });
  it.each([
    new Uint8Array(),
    new Uint8Array([1, 2]),
    concat(base(), new Uint8Array([1])),
    concat(base(), ext(5, new Uint8Array([1]))),
    concat(base(), ext(99, new Uint8Array())),
    concat(base(), ext(1, new Uint8Array(11))),
  ])("rejects incomplete or unknown rule bytes %j", (bytes) =>
    expect(() => review(bytes)).toThrow(),
  );
  it("rejects duplicate rules rather than choosing an ambiguous override", () => {
    const e = ext(2, concat(uint(2, 4), uint(60, 4)));
    expect(() => review(concat(base(), e, e))).toThrow(/Duplicate/);
  });
  it.each([
    new Uint8Array([24, 17, 0, 0, 0]),
    new Uint8Array([9, 17, 128, 0, 0]),
    new Uint8Array([9, 17, 0, 255, 127]),
  ])("rejects invalid allowed-time rule %j", (bytes) =>
    expect(() => review(concat(base(), ext(3, bytes)))).toThrow(/Invalid/),
  );
  it("does not invent decoded remote recipients or asset units", () => {
    const bytes = base();
    expect(() =>
      review(bytes, false, details(bytes).replace("kind: 0", "kind: 1")),
    ).toThrow(/cannot yet be decoded/);
  });
  it("rejects a contradictory unused recipient list and oversized policy", () => {
    expect(() => review(base(0, [2]))).toThrow(/unused/);
    expect(() => review(new Uint8Array(2049))).toThrow(/malformed/);
  });
});

it("decodes disabled and per-transfer caps using exact program sentinel semantics", () => {
  expect(review(concat(base(), ext(1, new Uint8Array(12))))).toContain(
    "Transfer total cap: Not enforced",
  );
  expect(review(concat(base(), ext(2, new Uint8Array(8))))).toContain(
    "Transfer count cap: Not enforced",
  );
  expect(
    review(
      concat(base(), ext(4, concat(key(8).toBytes(), uint(1, 8), uint(0, 4)))),
    ),
  ).toContain("per transfer");
  expect(
    review(
      concat(base(), ext(4, concat(key(8).toBytes(), uint(0, 8), uint(0, 4)))),
    ),
  ).toContain("All transfers proposed by this member are blocked");
});
it("never portrays duplicate proposer caps as jointly enforced", () => {
  const cap = concat(key(8).toBytes(), uint(1, 8), uint(60, 4));
  expect(() => review(concat(base(), ext(4, concat(cap, cap))))).toThrow(
    /Duplicate member/,
  );
});
it("explains proposer scope, approval-based delay and recurring incompatibility", () => {
  const b = concat(
    base(),
    ext(4, concat(key(8).toBytes(), uint(1, 8), uint(60, 4))),
  );
  const text = review(scope(b), true);
  expect(text).toContain("after approval and the governance timelock");
  expect(text).toContain("requests proposed by");
  expect(text).toContain("Unlisted proposers");
  expect(text).toContain("recurring-payment execution rejects");
});

it("binds advanced velocity to the same enabled base accounting window regardless of extension order", () => {
  const rule = concat(
    new Uint8Array([1, 1, 0, 1, 0]),
    uint(0, 4),
    ext(4, concat(uint(10, 8), uint(60, 4))),
  );
  const advanced = ext(5, rule),
    tracking = ext(1, concat(uint(18446744073709551615n, 8), uint(60, 4)));
  expect(review(concat(base(), advanced, tracking))).toContain(
    "tracked 60-second",
  );
  expect(() => review(concat(base(), advanced))).toThrow(/base tracking/);
  expect(() =>
    review(concat(base(), advanced, ext(1, concat(uint(1, 8), uint(120, 4))))),
  ).toThrow(/same window/);
});
