import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import {
  executeSavedEscrow,
  escrowPaths,
  type EscrowOperation,
} from "./escrowOperation";
const record: EscrowOperation = {
  version: 1,
  walletName: "test",
  proposalAddress: "proposal",
  envelopeHash: "a".repeat(64),
  payloadHash: "b".repeat(64),
  phase: "created",
  execute: {
    kind: "release",
    escrowId: "escrow",
    milestoneId: "mile",
    recipient: "recipient",
    amountLamports: 1,
  },
};
const evidence = (status: number) => ({
  sections: [
    { title: "DETAILS", text: "Escrow ID: escrow\nMilestone ID: mile" },
  ],
  proposalAddress: record.proposalAddress,
  envelopeHash: record.envelopeHash,
  payloadHash: record.payloadHash,
  binding: { actionKind: 7 },
  status,
});
const txid = bs58.encode(new Uint8Array(64).fill(2));
describe("escrow execution evidence lifecycle", () => {
  it("does not mark an empty HTTP response as execution", async () => {
    const save = vi.fn(),
      submit = vi.fn(async () => ({}));
    const result = await executeSavedEscrow(record, {
      read: async () => evidence(1),
      submit,
      save,
    });
    expect(result.phase).toBe("unknown");
    expect(save.mock.calls[0][0].phase).toBe("executing");
    expect(submit).toHaveBeenCalledOnce();
    await expect(
      executeSavedEscrow(result, {
        read: async () => evidence(1),
        submit,
        save,
      }),
    ).rejects.toThrow("already attempted");
    expect(submit).toHaveBeenCalledOnce();
  });
  it("retains a transaction ID as submitted until finalized matching evidence exists", async () => {
    const result = await executeSavedEscrow(record, {
      read: async () => evidence(1),
      submit: async () => ({
        txid,
        proposal: "proposal",
        path: escrowPaths.release,
      }),
      save: vi.fn(),
    });
    expect(result).toMatchObject({ phase: "submitted", txid });
  });
  it("records execution only from matching finalized account status", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(evidence(1))
      .mockResolvedValueOnce(evidence(2));
    const result = await executeSavedEscrow(record, {
      read,
      submit: async () => ({
        txid,
        proposal: "proposal",
        path: escrowPaths.release,
      }),
      save: vi.fn(),
    });
    expect(result.phase).toBe("confirmed");
  });
  it("never submits before approvals or repeats an already executed request", async () => {
    const submit = vi.fn();
    for (const status of [0, 2, 3])
      await executeSavedEscrow(record, {
        read: async () => evidence(status),
        submit,
        save: vi.fn(),
      });
    expect(submit).not.toHaveBeenCalled();
  });
  it("rejects unrelated account evidence before calling any execute endpoint", async () => {
    const submit = vi.fn();
    await expect(
      executeSavedEscrow(record, {
        read: async () => ({ ...evidence(1), envelopeHash: "c".repeat(64) }),
        submit,
        save: vi.fn(),
      }),
    ).rejects.toThrow("does not match");
    expect(submit).not.toHaveBeenCalled();
  });
  it.each(Object.keys(escrowPaths))(
    "keeps %s submitted without finalized execution",
    async (kind) => {
      const saved = {
        ...record,
        execute: { ...record.execute, kind } as EscrowOperation["execute"],
      };
      const result = await executeSavedEscrow(saved, {
        read: async () => ({
          ...evidence(1),
          binding: { actionKind: kind.endsWith("release") ? 7 : 8 },
        }),
        submit: async () => ({
          txid,
          proposal: "proposal",
          path: escrowPaths[saved.execute.kind],
        }),
        save: vi.fn(),
      });
      expect(result.phase).toBe("submitted");
    },
  );
});
