import { describe, expect, it } from "vitest";
import {
  addressFingerprint,
  assessDestination,
  groupAddress,
} from "../addressSafety";

const MARA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
// Same first/last four characters as MARA, different middle.
const POISON = "7xKXAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAsU";
const OTHER = "9QQQtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgZZZ";
const contacts = [{ name: "Mara", address: MARA }];

describe("assessDestination", () => {
  it("recognises a saved contact", () => {
    expect(assessDestination(MARA, contacts, [])).toEqual({ kind: "saved", name: "Mara" });
  });
  it("flags an address that copies a trusted address's ends", () => {
    expect(POISON.length).toBe(MARA.length);
    expect(assessDestination(POISON, contacts, [])).toEqual({
      kind: "lookalike",
      name: "Mara",
      address: MARA,
    });
  });
  it("also checks recent recipients for look-alikes", () => {
    const r = assessDestination(POISON, [], [MARA]);
    expect(r.kind).toBe("lookalike");
  });
  it("separates seen-before from first-time", () => {
    expect(assessDestination(OTHER, [], [OTHER]).kind).toBe("seen-before");
    expect(assessDestination(OTHER, contacts, []).kind).toBe("first-time");
  });
});

describe("address display helpers", () => {
  it("grouping is lossless", () => {
    expect(groupAddress(MARA).join("")).toBe(MARA);
    expect(groupAddress("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
  });
  it("fingerprints are stable and differ between addresses", () => {
    expect(addressFingerprint(MARA)).toEqual(addressFingerprint(MARA));
    expect(addressFingerprint(MARA)).not.toEqual(addressFingerprint(OTHER));
  });
});
