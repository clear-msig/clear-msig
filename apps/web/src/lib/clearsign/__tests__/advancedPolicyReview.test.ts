import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { reviewAdvancedPolicy } from "../advancedPolicyReview";
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
const condition = (kind: number, bytes: Uint8Array) =>
  concat(new Uint8Array([kind]), uint(bytes.length, 2), bytes);
const rule = (
  action: number,
  conditions: Uint8Array[] = [],
  approvers: number[] = [],
  delay = 0,
) =>
  concat(
    new Uint8Array([action, conditions.length, approvers.length]),
    uint(delay, 4),
    ...approvers.map((n) => key(n).toBytes()),
    ...conditions,
  );
const payload = (...rules: Uint8Array[]) =>
  concat(new Uint8Array([1, rules.length]), ...rules);
const review = (bytes: Uint8Array, window?: number) =>
  reviewAdvancedPolicy(bytes, (n) => `${n} raw SOL units`, window).join("\n");
describe("advanced v1 committed rule review (program-layout fixtures)", () => {
  it("shows all ordered rules without claiming all effects apply", () => {
    const text = review(payload(rule(1), rule(0)));
    expect(text).toContain("First matching rule only");
    expect(text).toContain("Every condition");
    expect(text).toContain("base policy and governance");
    expect(text.indexOf("Rule 1: Add no extra restriction")).toBeLessThan(
      text.indexOf("Rule 2: Deny"),
    );
    expect(text).toContain("Always (no conditions)");
  });
  it("renders exact required signers and approval-based delay", () => {
    const text = review(payload(rule(2, [], [8, 9]), rule(3, [], [], 120)));
    expect(text).toContain(key(8).toBase58());
    expect(text).toContain(key(9).toBase58());
    expect(text).toContain(
      "120-second delay after approval and the governance timelock",
    );
  });
  it("preserves full recipients and empty-list meaning", () => {
    expect(
      review(
        payload(
          rule(0, [
            condition(1, concat(new Uint8Array([1, 1]), key(2).toBytes())),
          ]),
        ),
      ),
    ).toContain(key(2).toBase58());
    expect(
      review(payload(rule(0, [condition(1, new Uint8Array([1, 0]))]))),
    ).toContain("No address can match");
    expect(
      review(payload(rule(0, [condition(1, new Uint8Array([2, 0]))]))),
    ).toContain("Every address matches");
  });
  it("uses exact integers and inclusive amount conditions", () => {
    const conditionBytes = condition(
      2,
      concat(
        new Uint8Array([3]),
        uint(9007199254740993n, 8),
        uint(18446744073709551615n, 8),
      ),
    );
    const text = review(payload(rule(0, [conditionBytes])));
    expect(text).toContain("at least 9007199254740993 raw SOL units");
    expect(text).toContain("at most 18446744073709551615 raw SOL units");
  });
  it("identifies impossible amount bounds", () =>
    expect(
      review(
        payload(
          rule(0, [
            condition(2, concat(new Uint8Array([3]), uint(9, 8), uint(1, 8))),
          ]),
        ),
      ),
    ).toContain("no amount can satisfy"));
  it("renders outside the combined day/hour window and timezone sign", () => {
    const bytes = condition(
      3,
      concat(new Uint8Array([22, 6, 2, 2]), uint(300, 2)),
    );
    const text = review(payload(rule(0, [bytes])));
    for (const part of [
      "outside",
      "combined window",
      "22:00 inclusive",
      "06:00 exclusive",
      "overnight",
      "Monday",
      "UTC-05:00",
    ])
      expect(text).toContain(part);
  });
  it.each([
    [1, "Never matches"],
    [2, "Always matches"],
  ])("handles empty time window match mode %s", (mode, text) =>
    expect(
      review(
        payload(
          rule(0, [
            condition(3, new Uint8Array([9, 9, 2, mode as number, 0, 0])),
          ]),
        ),
      ),
    ).toContain(text),
  );
  it("shows velocity as a strict projected-total trigger, not a flat allowance", () =>
    expect(
      review(
        payload(rule(0, [condition(4, concat(uint(10, 8), uint(60, 4)))])),
        60,
      ),
    ).toContain(
      "Projected transfer total exceeds 10 raw SOL units in the tracked 60-second window (including this transfer)",
    ));
  it.each([
    new Uint8Array(),
    new Uint8Array([2, 0]),
    new Uint8Array([1, 17]),
    payload(rule(4)),
    payload(rule(2)),
    payload(rule(3)),
    payload(rule(0, [], [1])),
    payload(rule(1, [], [], 10)),
    concat(payload(rule(0)), new Uint8Array([0])),
    payload(rule(0, [condition(99, new Uint8Array())])),
    payload(rule(0, [condition(4, new Uint8Array(12))])),
    payload(rule(0, [condition(2, new Uint8Array(16))])),
  ])("rejects malformed, ambiguous or unsupported bytes %j", (bytes) =>
    expect(() => review(bytes)).toThrow(),
  );
  it("rejects every truncated prefix of a nonempty complete rule", () => {
    const complete = payload(
      rule(
        2,
        [condition(1, concat(new Uint8Array([1, 1]), key(3).toBytes()))],
        [2],
      ),
    );
    for (let size = 0; size < complete.length; size++)
      expect(() => review(complete.subarray(0, size))).toThrow();
  });
});

it("refuses to promise a tracked window without matching enabled base accounting", () => {
  const bytes = payload(
    rule(0, [condition(4, concat(uint(10, 8), uint(60, 4)))]),
  );
  expect(() => review(bytes)).toThrow(/base tracking/);
  expect(() => review(bytes, 120)).toThrow(/same window/);
  expect(review(bytes, 60)).toContain("tracked 60-second");
});
