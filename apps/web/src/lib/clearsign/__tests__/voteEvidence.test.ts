import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import type { CancellationContext } from "../cancellationReview";
import { requestRecovery, RequestRecoveryStore } from "../requestRecovery";
import { submitReviewedVote } from "../submitReviewedVote";
import {
  voteContextHash,
  voteIsRecorded,
  submittedVoteTxid,
  type RequestVote,
} from "../voteEvidence";
const address = "11111111111111111111111111111111",
  actor = new PublicKey(new Uint8Array(32).fill(8)).toBase58(),
  other = new PublicKey(new Uint8Array(32).fill(9)).toBase58(),
  txid = bs58.encode(new Uint8Array(64).fill(8)),
  endpoint = "vote-fixture";
function context(): CancellationContext {
  return {
    address,
    walletName: "Example",
    fingerprint: "snapshot",
    chainIdentity: "genesis:program",
    proposal: {
      typed: true,
      wallet: "wallet",
      intent: "intent",
      proposalIndex: 2n,
      actionKind: 1,
      approvalBitmap: 0,
      cancellationBitmap: 0,
      envelopeHash: "envelope",
      payloadHash: "payload",
      policyCommitment: "policy",
      actionId: "action",
      nonce: "nonce",
    },
    intent: {
      approvers: [actor, other],
      approvalThreshold: 2,
      cancellationThreshold: 2,
    },
  } as unknown as CancellationContext;
}
function recorded(
  c: CancellationContext,
  vote: RequestVote,
  memberIndex = 0,
): CancellationContext {
  return {
    ...c,
    proposal: {
      ...c.proposal,
      [vote === "approve" ? "approvalBitmap" : "cancellationBitmap"]:
        1 << memberIndex,
    },
  };
}
function setup(
  vote: RequestVote = "approve",
  result: unknown = { txid, action: `typed_${vote}`, approver_index: 0 },
) {
  const current = context(),
    submit = vi.fn(async () => result),
    read = vi.fn(async () => current),
    assertCurrent = vi.fn();
  const input = {
    context: current,
    actor,
    vote,
    endpoint,
    accountKey: "aa".repeat(32),
    submit,
    read,
    assertCurrent,
  };
  return {
    current,
    input,
    submit,
    read,
    assertCurrent,
    run: () => submitReviewedVote(input),
  };
}
beforeEach(() => {
  for (const saved of requestRecovery.votesFor(endpoint, address))
    requestRecovery.resolveVote(saved.key);
});
describe("vote submission evidence versus finalized actor vote", () => {
  it.each(["approve", "cancel"] as const)(
    "keeps valid %s receipt pending until this actor's vote is finalized",
    async (vote) => {
      const s = setup(vote);
      expect((await s.run()).state).toBe("submitted");
      expect(requestRecovery.voteFor(endpoint, address, actor)?.txid).toBe(
        txid,
      );
      await expect(s.run()).rejects.toThrow(/may already/);
      expect(s.submit).toHaveBeenCalledOnce();
    },
  );
  it.each(["approve", "cancel"] as const)(
    "confirms %s only with unchanged authority and correct finalized actor bitmap",
    async (vote) => {
      const s = setup(vote);
      s.read.mockResolvedValue(recorded(s.current, vote));
      expect((await s.run()).state).toBe("confirmed");
      expect(requestRecovery.voteFor(endpoint, address, actor)).toBeUndefined();
    },
  );
  it.each([
    {},
    null,
    { txid: "broken", action: "typed_approve", approver_index: 0 },
    { txid, action: "typed_cancel", approver_index: 0 },
    { txid, action: "typed_approve", approver_index: 1 },
    { txid, action: "typed_approve", approver_index: 0, proposal: other },
  ])(
    "does not report success for malformed/substituted response %j",
    async (result) => {
      const s = setup("approve", result);
      s.read.mockResolvedValue(recorded(s.current, "approve"));
      expect((await s.run()).state).toBe("unknown");
      expect(s.read).not.toHaveBeenCalled();
      expect(requestRecovery.voteFor(endpoint, address, actor)?.outcome).toBe(
        "unknown",
      );
    },
  );
  it("does not mistake another member's vote for this actor's vote", async () => {
    const s = setup();
    s.read.mockResolvedValue(recorded(s.current, "approve", 1));
    expect((await s.run()).state).toBe("submitted");
  });
  it("preserves request on delayed transport error and blocks blind retry", async () => {
    const s = setup();
    s.submit.mockRejectedValue(new Error("Timeout after broadcast"));
    expect((await s.run()).state).toBe("unknown");
    await expect(s.run()).rejects.toThrow(/may already/);
    expect(requestRecovery.voteFor(endpoint, address, actor)?.proposal).toBe(
      address,
    );
  });
  it("does not lose known submission evidence when identity changes after server response", async () => {
    const s = setup();
    s.assertCurrent
      .mockImplementationOnce(() => {})
      .mockImplementation(() => {
        throw new Error("account changed");
      });
    await expect(s.run()).rejects.toThrow(/account changed/);
    expect(requestRecovery.voteFor(endpoint, address, actor)?.txid).toBe(txid);
  });
  it("does not confirm on network or authority changes", async () => {
    const s = setup();
    s.read.mockResolvedValue({
      ...recorded(s.current, "approve"),
      chainIdentity: "other-genesis:program",
    });
    expect((await s.run()).state).toBe("submitted");
    const different = recorded(s.current, "approve");
    different.intent = { ...different.intent, approvers: [other, actor] };
    expect(
      voteIsRecorded(different, voteContextHash(s.current), actor, "approve"),
    ).toBe(false);
  });
  it("requires exact legacy cancel action and actor index too", () => {
    const c = context();
    c.proposal = {
      ...c.proposal,
      typed: false,
      paramsData: new Uint8Array([1]),
    };
    expect(
      submittedVoteTxid(
        { txid, action: "cancel", approver_index: 0 },
        c,
        actor,
        "cancel",
      ),
    ).toBe(txid);
    expect(() =>
      submittedVoteTxid(
        { txid, action: "approve", approver_index: 0 },
        c,
        actor,
        "cancel",
      ),
    ).toThrow();
  });
  it("retains vote recovery through reload and disallows separate-request acknowledgement", () => {
    const memory = new Map<string, string>(),
      storage = {
        getItem: (key: string) => memory.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memory.set(key, value);
        },
      };
    const store = new RequestRecoveryStore(storage),
      current = context();
    const pending = store.begin({
      walletName: "Example",
      endpoint,
      accountKey: "aa".repeat(32),
      label: "Approval vote",
      identity: [address, actor],
      phase: "vote",
      actor,
      vote: "approve",
      voteContext: voteContextHash(current),
    });
    pending.submitting(address);
    pending.finish();
    const restored = new RequestRecoveryStore(storage),
      saved = restored.voteFor(endpoint, address, actor)!;
    expect(saved.vote).toBe("approve");
    expect(() => restored.acknowledgeSeparateRequest(saved.key)).toThrow(
      /may already/,
    );
  });
});
