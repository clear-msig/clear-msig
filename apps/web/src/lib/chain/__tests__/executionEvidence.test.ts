import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import { solanaSubmissionTxid } from "../executionEvidence";
const txid = bs58.encode(new Uint8Array(64).fill(9));
const expected = {
  proposal: "reviewed-request",
  path: "typed_sol_batch_send",
  requireProposal: true,
};
const valid = { txid, proposal: expected.proposal, path: expected.path };
describe("Solana submission evidence (not confirmation)", () => {
  it("accepts a canonical transaction signature for the expected proposal/action", () =>
    expect(solanaSubmissionTxid(valid, expected)).toBe(txid));
  it.each([
    null,
    {},
    { txid: "" },
    { ...valid, txid: "garbage" },
    { ...valid, txid: bs58.encode(new Uint8Array(32).fill(9)) },
    { ...valid, txid: bs58.encode(new Uint8Array(64)) },
    { ...valid, txid: ` ${txid}` },
    { ...valid, proposal: "other" },
    { ...valid, proposal_pubkey: "other" },
    { ...valid, path: "other-action" },
    { txid, path: expected.path },
  ])("rejects malformed/mismatched response %#", (response) =>
    expect(() => solanaSubmissionTxid(response, expected)).toThrow(),
  );
  it("supports optional proposal fields for endpoint variants but still checks them when supplied", () => {
    expect(
      solanaSubmissionTxid({ txid }, { proposal: "reviewed-request" }),
    ).toBe(txid);
    expect(() =>
      solanaSubmissionTxid(
        { txid, proposal: "other" },
        { proposal: "reviewed-request" },
      ),
    ).toThrow();
  });
});
