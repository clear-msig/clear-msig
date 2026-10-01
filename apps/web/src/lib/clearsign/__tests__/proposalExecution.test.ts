import { describe, expect, it } from "vitest";
import bs58 from "bs58";
import type { AnyProposalAccount, IntentAccount } from "@/lib/msig/accounts";
import type { CanonicalProposalReview } from "../proposalReview";
import {
  executionKind,
  executionOutcomeLabel,
  nativeSolExecutionFromReview,
  verifiedExecutionSubmission,
} from "../proposalExecution";
const address = "11111111111111111111111111111111";
const txid = bs58.encode(new Uint8Array(64).fill(8));
const proposal = { typed: true, actionKind: 3 } as AnyProposalAccount;
const intent = { intentType: 3, chainKind: 0 } as IntentAccount;
const reviewed = () =>
  ({
    binding: { actionKind: 1 },
    network: "Solana Devnet",
    headline: "Send 0.3 SOL",
    sections: [
      {
        title: "DETAILS",
        text: `From wallet: Example\nNetwork: Solana Devnet\nAmount: 0.3 SOL\nTo: ${address}`,
      },
    ],
  }) as unknown as CanonicalProposalReview;
describe("existing proposal execution evidence and labels", () => {
  it("binds governance submission evidence without treating it as finality", () => {
    expect(
      verifiedExecutionSubmission(
        {
          txid,
          proposal: address,
          path: "typed_intent_governance",
          action_kind: 3,
        },
        address,
        proposal,
        intent,
      ),
    ).toBe(txid);
    expect(
      executionOutcomeLabel({
        state: "submitted",
        kind: "governance",
        proposal: address,
      }),
    ).toBe("Governance change submitted; verification pending");
  });
  it.each([
    {},
    { txid: "not-a-signature" },
    {
      txid,
      proposal: "wrong",
      path: "typed_intent_governance",
      action_kind: 3,
    },
    { txid, proposal: address, path: "typed_sol_send", action_kind: 3 },
    {
      txid,
      proposal: address,
      path: "typed_intent_governance",
      action_kind: 5,
    },
  ])("rejects missing, malformed or substituted evidence %j", (result) => {
    expect(() =>
      verifiedExecutionSubmission(result, address, proposal, intent),
    ).toThrow();
  });
  it.each([1, 4, 5])(
    "accepts only context-matched EVM broadcast evidence for chain%s without claiming finality",
    (chainKind) => {
      const legacy = { typed: false } as AnyProposalAccount;
      const remote = { ...intent, chainKind };
      const response = {
        txid,
        path: "ika-dwallet",
        chain_kind: chainKind,
        broadcast: { chain_kind: chainKind, tx_id: "0x" + "ab".repeat(32) },
      };
      expect(
        verifiedExecutionSubmission(response, address, legacy, remote),
      ).toBe(txid);
      expect(() =>
        verifiedExecutionSubmission(
          { ...response, broadcast: { ...response.broadcast, chain_kind: 99 } },
          address,
          legacy,
          remote,
        ),
      ).toThrow();
    },
  );
  it("does not infer destination completion from typed action kind1 or Solana status", () => {
    const kind = executionKind(
      { ...proposal, actionKind: 1 } as AnyProposalAccount,
      { ...intent, chainKind: 1 },
    );
    expect(kind).toBe("external");
    expect(
      executionOutcomeLabel({ kind, state: "confirmed", proposal: address }),
    ).toContain("destination status unverified");
  });
  it.each([7, 8, 9, 10, 11, 12, 13, 14, 15])(
    "does not call action%s an executed trade or transferred money",
    (actionKind) => {
      expect(
        executionKind(
          { ...proposal, actionKind } as AnyProposalAccount,
          intent,
        ),
      ).toBe("action");
    },
  );
  it("extracts exact native SOL transfer arguments from full-profile review", () => {
    expect(nativeSolExecutionFromReview(reviewed(), 0)).toEqual({
      recipient: address,
      amountLamports: 300000000,
    });
  });
  it.each([
    "0.0000000001",
    "9007199.254740992",
    "-1",
    "1e3",
    "NaN",
    "0",
    "00.3",
  ])("rejects inexact/out-of-range native amount%s", (amount) => {
    const r = reviewed();
    r.headline = `Send ${amount} SOL`;
    r.sections = [
      { title: "DETAILS", text: `Amount: ${amount} SOL\nTo: ${address}` },
    ];
    expect(() => nativeSolExecutionFromReview(r, 0)).toThrow();
  });
  it("rejects changed network, action label, token scope, malformed or duplicate recipient", () => {
    expect(() =>
      nativeSolExecutionFromReview(
        { ...reviewed(), network: "Ethereum Sepolia" },
        0,
      ),
    ).toThrow();
    expect(() => nativeSolExecutionFromReview(reviewed(), 1)).toThrow();
    expect(() =>
      nativeSolExecutionFromReview(
        { ...reviewed(), headline: "Send 3 SOL" },
        0,
      ),
    ).toThrow();
    for (const extra of ["\nAsset ID: token", `\nTo: ${address}`]) {
      const r = reviewed();
      r.sections = [{ ...r.sections[0], text: r.sections[0].text + extra }];
      expect(() => nativeSolExecutionFromReview(r, 0)).toThrow();
    }
    const r = reviewed();
    r.sections = [{ title: "DETAILS", text: "Amount: 0.3 SOL\nTo: invalid" }];
    expect(() => nativeSolExecutionFromReview(r, 0)).toThrow();
  });
  it("requires native response to preserve path, full destination and exact raw amount", () => {
    const native = nativeSolExecutionFromReview(reviewed(), 0),
      p = { ...proposal, actionKind: 1 } as AnyProposalAccount;
    const response = {
      txid,
      proposal: address,
      path: "typed_sol_send",
      recipient: address,
      amount_lamports: native.amountLamports,
    };
    expect(
      verifiedExecutionSubmission(response, address, p, intent, native),
    ).toBe(txid);
    expect(() =>
      verifiedExecutionSubmission(
        { ...response, amount_lamports: 1 },
        address,
        p,
        intent,
        native,
      ),
    ).toThrow();
    expect(() =>
      verifiedExecutionSubmission(
        { ...response, recipient: "wrong" },
        address,
        p,
        intent,
        native,
      ),
    ).toThrow();
  });
});
