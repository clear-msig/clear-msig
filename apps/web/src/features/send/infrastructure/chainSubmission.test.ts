import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { verifyChainSubmission } from "./chainSubmission";
const proposal = "11111111111111111111111111111111";
const receipt = (chainKind = 1) => ({ txid: bs58.encode(new Uint8Array(64).fill(3)), path: "ika-dwallet", chain_kind: chainKind, broadcast: { chain_kind: chainKind, tx_id: `${[1,4,5].includes(chainKind) ? "0x" : ""}${"a".repeat(64)}` } });
describe("destination broadcast evidence never implies finality", () => {
  it.each([1,2,3,4,5])("accepts supported chain%s submission identifiers", (kind) => {
    expect(() => verifyChainSubmission(receipt(kind), proposal, kind)).not.toThrow();
  });
  it.each([{}, { ...receipt(), txid: "fake" }, { ...receipt(), path: "typed" }, { ...receipt(), proposal: "another" }, { ...receipt(), chain_kind: 2 }, { ...receipt(), broadcast: { chain_kind: 2, tx_id: `0x${"a".repeat(64)}` } }, { ...receipt(), broadcast: { chain_kind: 1, tx_id: "not-a-hash" } }])("rejects missing, substituted or malformed evidence", (value) => {
    expect(() => verifyChainSubmission(value, proposal, 1)).toThrow();
  });
});
