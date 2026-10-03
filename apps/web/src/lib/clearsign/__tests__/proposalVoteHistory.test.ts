import { describe, expect, it, vi } from "vitest";
import {
  Keypair,
  type Connection,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import {
  decodeHistoricalVote,
  historicalVoteMessage,
  inspectVoteTransaction,
  readBoundedVoteHistory,
  type VoteHistoryContext,
} from "../proposalVoteHistory";
import type { CanonicalProposalReview } from "../proposalReview";

const member = Keypair.generate(),
  payer = Keypair.generate();
const wallet = Keypair.generate().publicKey,
  intent = Keypair.generate().publicKey,
  proposal = Keypair.generate().publicKey;
const review = {
  document: "CLEAR SIGN\nSynthetic canonical document",
  proposalAddress: proposal.toBase58(),
  walletName: "Test wallet",
  expiresAt: 1800000000n,
  envelopeHash: "ab".repeat(32),
  binding: { wallet: wallet.toBase58(), intent: intent.toBase58(), index: 7n },
} as CanonicalProposalReview;
const context: VoteHistoryContext = {
  wallet: wallet.toBase58(),
  intent: intent.toBase58(),
  proposal: proposal.toBase58(),
  approvers: [member.publicKey.toBase58()],
  approvalThreshold: 2,
  cancellationThreshold: 1,
  canonical: review,
};
// Independent literal suffix from Rust write_vote_message_for_clear_text.
function message(vote = "APPROVE", required = 2, after = 1) {
  const label =
    vote === "APPROVE"
      ? required === 1
        ? "approval"
        : "approvals"
      : required === 1
        ? "cancellation"
        : "cancellations";
  return new TextEncoder().encode(
    `CLEAR SIGN\nSynthetic canonical document\n\nAPPROVAL\nDecision: ${vote}\nProposal: #7\nWallet: Test wallet\nRequested by: ${member.publicKey}\nRequirement: ${required} ${label}\nStatus if accepted: ${after} of ${required} ${label}\n\nEXPIRY\n2027-01-15 08:00:00 UTC\n\nPROOF\nClearSign: v4\nEnvelope: ${"ab".repeat(32)}`,
  );
}
function instruction(
  tag = 9,
  bytes = nacl.sign.detached(message(), member.secretKey),
) {
  const data = new Uint8Array(tag === 2 || tag === 3 ? 74 : 66);
  data[0] = tag;
  data.set(bytes, data.length - 64);
  return {
    programId: CLEAR_WALLET_PROGRAM_ID,
    accounts: [wallet, intent, proposal],
    data: bs58.encode(data),
  };
}
function transaction(ix = instruction(), time: number | null = 1700000000) {
  return {
    slot: 99,
    blockTime: time,
    meta: { err: null, innerInstructions: [] },
    transaction: {
      signatures: ["tx"],
      message: {
        accountKeys: [
          { pubkey: payer.publicKey, signer: true, writable: true },
        ],
        instructions: [ix],
      },
    },
  } as unknown as ParsedTransactionWithMeta;
}
const signature = (id = "tx") => ({
  signature: id,
  slot: 99,
  err: null,
  memo: null,
  blockTime: 1700000000,
  confirmationStatus: "finalized" as const,
});

describe("finalized historical vote evidence (synthetic RPC and signatures)", () => {
  it("matches the independent full v4 signed message", () =>
    expect(
      historicalVoteMessage(
        review,
        member.publicKey.toBase58(),
        "approve",
        2,
        1,
      ),
    ).toEqual(message()));
  it.each([2, 3, 9, 10])(
    "decodes generated discriminator %i without treating fee payer as voter",
    (tag) =>
      expect(decodeHistoricalVote(instruction(tag), context)?.memberIndex).toBe(
        0,
      ),
  );
  it("rejects wrong account, program, length, tag and member index", () => {
    const ix = instruction();
    expect(
      decodeHistoricalVote(
        { ...ix, accounts: [payer.publicKey, intent, proposal] },
        context,
      ),
    ).toBeNull();
    expect(
      decodeHistoricalVote({ ...ix, programId: payer.publicKey }, context),
    ).toBeNull();
    expect(
      decodeHistoricalVote(
        { ...ix, data: bs58.encode(new Uint8Array(67)) },
        context,
      ),
    ).toBeNull();
    const data = bs58.decode(ix.data);
    data[1] = 16;
    expect(
      decodeHistoricalVote({ ...ix, data: bs58.encode(data) }, context),
    ).toBeNull();
    expect(decodeHistoricalVote(instruction(11), context)).toBeNull();
  });
  it("attributes cryptographically to actual member, not fee payer", async () => {
    const { rows } = await inspectVoteTransaction(
      transaction(),
      "tx",
      99,
      context,
    );
    expect(rows[0].signer).toBe(member.publicKey.toBase58());
    expect(rows[0].signer).not.toBe(payer.publicKey.toBase58());
    expect(rows[0].blockTime).toBe(1700000000);
  });
  it("verifies cancellation and a later accepted count", async () => {
    const ix = instruction(
      10,
      nacl.sign.detached(message("CANCEL", 1, 3), member.secretKey),
    );
    expect(
      (await inspectVoteTransaction(transaction(ix), "tx", 99, context))
        .rows[0],
    ).toMatchObject({ signer: member.publicKey.toBase58(), vote: "cancel" });
  });
  it("does not invent missing time or historical roster/threshold", async () => {
    expect(
      (
        await inspectVoteTransaction(
          transaction(instruction(), null),
          "tx",
          99,
          context,
        )
      ).rows[0].blockTime,
    ).toBeNull();
    for (const altered of [
      { ...context, approvers: [payer.publicKey.toBase58()] },
      { ...context, approvalThreshold: 3 },
      { ...context, canonical: undefined },
    ])
      expect(
        (await inspectVoteTransaction(transaction(), "tx", 99, altered)).rows[0]
          .signer,
      ).toBeNull();
  });
  it("does not attribute legacy or mismatched canonical document", async () => {
    expect(
      (
        await inspectVoteTransaction(
          transaction(instruction(2)),
          "tx",
          99,
          context,
        )
      ).rows[0].signer,
    ).toBeNull();
    expect(
      (
        await inspectVoteTransaction(transaction(), "tx", 99, {
          ...context,
          canonical: { ...review, proposalAddress: wallet.toBase58() },
        })
      ).rows[0].signer,
    ).toBeNull();
  });
  it("rejects failed/mismatched transaction identity and excludes CPI", async () => {
    const tx = transaction();
    tx.meta!.err = { InstructionError: [0, "Custom"] } as never;
    await expect(
      inspectVoteTransaction(tx, "tx", 99, context),
    ).rejects.toThrow();
    await expect(
      inspectVoteTransaction(transaction(), "other", 99, context),
    ).rejects.toThrow();
    await expect(
      inspectVoteTransaction(transaction(), "tx", 100, context),
    ).rejects.toThrow();
    const inner = transaction();
    inner.transaction.message.instructions = [];
    inner.meta!.innerInstructions = [
      { index: 0, instructions: [instruction()] },
    ];
    expect(await inspectVoteTransaction(inner, "tx", 99, context)).toEqual({
      rows: [],
      innerVoteInstructions: 1,
    });
  });
  it("labels pruned, nonfinalized and failed history without converting to votes", async () => {
    const rpc = {
      getSignaturesForAddress: vi
        .fn()
        .mockResolvedValue([
          signature(),
          { ...signature("pending"), confirmationStatus: "confirmed" },
          { ...signature("failed"), err: { InstructionError: [0, "Custom"] } },
        ]),
      getParsedTransaction: vi.fn().mockResolvedValue(null),
    };
    const result = await readBoundedVoteHistory(
      rpc as unknown as Connection,
      context,
      "genesis",
    );
    expect(result).toMatchObject({
      rows: [],
      scannedTransactions: 3,
      unavailableTransactions: 2,
      failedTransactions: 1,
    });
    expect(rpc.getParsedTransaction).toHaveBeenCalledTimes(1);
  });
  it("bounds pagination to 16 transactions, requesting finalized reads", async () => {
    const rpc = {
      getSignaturesForAddress: vi
        .fn()
        .mockResolvedValueOnce(
          Array.from({ length: 8 }, (_, i) => signature(`a${i}`)),
        )
        .mockResolvedValueOnce(
          Array.from({ length: 8 }, (_, i) => signature(`b${i}`)),
        ),
      getParsedTransaction: vi.fn().mockImplementation(async (id: string) => {
        const tx = transaction();
        tx.transaction.signatures = [id];
        tx.transaction.message.instructions = [];
        return tx;
      }),
    };
    const result = await readBoundedVoteHistory(
      rpc as unknown as Connection,
      context,
      "genesis",
    );
    expect(result).toMatchObject({
      scannedTransactions: 16,
      stoppedAtLimit: true,
    });
    expect(rpc.getSignaturesForAddress).toHaveBeenLastCalledWith(
      proposal,
      { limit: 8, before: "a7" },
      "finalized",
    );
    expect(rpc.getParsedTransaction).toHaveBeenCalledWith("a0", {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
  });
  it("keeps evidence when a later page fails and flags partial read", async () => {
    const rpc = {
      getSignaturesForAddress: vi
        .fn()
        .mockResolvedValueOnce(
          Array.from({ length: 8 }, (_, i) => signature(`a${i}`)),
        )
        .mockRejectedValueOnce(new Error("offline")),
      getParsedTransaction: vi.fn().mockImplementation(async (id: string) => {
        const tx = transaction();
        tx.transaction.signatures = [id];
        return tx;
      }),
    };
    const result = await readBoundedVoteHistory(
      rpc as unknown as Connection,
      context,
      "genesis",
    );
    expect(result.scanError).toBe(true);
    expect(result.rows).toHaveLength(8);
  });
  it("rejects an oversized vote batch before cryptographic work", async () => {
    const tx = transaction();
    tx.transaction.message.instructions = Array.from({ length: 17 }, () =>
      instruction(),
    );
    const verify = vi.spyOn(crypto.subtle, "verify");
    await expect(inspectVoteTransaction(tx, "tx", 99, context)).rejects.toThrow(
      "Vote count",
    );
    expect(verify).not.toHaveBeenCalled();
    verify.mockRestore();
  });
  it("leaves signer unavailable when native verification is unsupported", async () => {
    const importKey = vi
      .spyOn(crypto.subtle, "importKey")
      .mockRejectedValueOnce(new Error("unsupported"));
    const result = await inspectVoteTransaction(
      transaction(),
      "tx",
      99,
      context,
    );
    expect(result.rows[0].signer).toBeNull();
    expect(result.rows[0].attribution).toContain("unsupported or failed");
    importKey.mockRestore();
  });
});
