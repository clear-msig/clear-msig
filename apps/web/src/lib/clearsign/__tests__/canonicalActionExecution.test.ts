import { describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import type { Connection } from "@solana/web3.js";
import {
  executeCanonicalAction,
  requireCanonicalCompletion,
  type CanonicalExecutionBinding,
} from "../canonicalActionExecution";
import { RequestRecoveryStore } from "../requestRecovery";
import type { readCanonicalProposalReview } from "../readProposalReview";
const proposal = "11111111111111111111111111111111";
const txid = bs58.encode(new Uint8Array(64).fill(7));
const paths: Record<number, string> = {
  6: "typed_wallet_policy_update",
  16: "typed_asset_policy_update",
  9: "typed_agent_trade_approval",
  12: "typed_agent_session_grant",
  13: "typed_agent_risk_policy",
  14: "typed_agent_trade_settlement",
};
function fixture(kind = 12) {
  const binding: CanonicalExecutionBinding = {
    actionKindCode: kind,
    envelopeHash: "a".repeat(64),
    payloadHash: "b".repeat(64),
    signableText: "ClearSig Approval\n\nSynthetic exact document",
  };
  const review = {
    status: 1,
    binding: { actionKind: kind, wallet: proposal },
    envelopeHash: binding.envelopeHash,
    payloadHash: binding.payloadHash,
    document: binding.signableText,
  } as Awaited<ReturnType<typeof readCanonicalProposalReview>>;
  const storage = new Map<string, string>();
  const recovery = new RequestRecoveryStore({
    getItem: (k) => storage.get(k) ?? null,
    setItem: (k, v) => {
      storage.set(k, v);
    },
  });
  const read = vi
    .fn<typeof readCanonicalProposalReview>()
    .mockResolvedValue(review);
  const execute = vi
    .fn()
    .mockResolvedValue({ txid, proposal, path: paths[kind] });
  const assertCurrent = vi.fn();
  const input = {
    connection: { rpcEndpoint: "synthetic://rpc" } as Connection,
    walletName: "Fixture",
    proposal,
    binding,
    expectedActionKind: kind,
    expectedWallet: proposal,
    accountKey: "c".repeat(64),
    assertCurrent,
    execute,
  };
  return { binding, review, read, execute, recovery, input, storage };
}
describe("canonical policy/agent execution finality with synthetic RPC/backend boundaries", () => {
  it.each(Object.keys(paths).map(Number))(
    "action %s: valid signature remains submitted until exact finalized execution",
    async (kind) => {
      const f = fixture(kind);
      expect(await executeCanonicalAction(f.input, f)).toEqual({
        state: "submitted",
        txid,
      });
      expect(
        f.recovery.executionFor(f.input.connection.rpcEndpoint, proposal)
          ?.phase,
      ).toBe("execution");
      expect(() =>
        requireCanonicalCompletion({ state: "submitted", txid }, proposal),
      ).toThrow(/verification is pending/);
      expect(await executeCanonicalAction(f.input, f)).toEqual({
        state: "submitted",
        txid,
      });
      expect(f.execute).toHaveBeenCalledTimes(1);
      f.read.mockResolvedValue({ ...f.review, status: 2 });
      expect(await executeCanonicalAction(f.input, f)).toEqual({
        state: "confirmed",
      });
      expect(f.execute).toHaveBeenCalledTimes(1);
      expect(
        f.recovery.executionFor(f.input.connection.rpcEndpoint, proposal),
      ).toBeUndefined();
    },
  );
  it.each([
    {},
    null,
    { txid: "made-up" },
    { txid, proposal, path: "wrong" },
    { txid, proposal: "wrong", path: paths[12] },
  ])(
    "invalid/empty response remains unknown and cannot replay: %j",
    async (response) => {
      const f = fixture();
      f.execute.mockResolvedValue(response);
      expect(await executeCanonicalAction(f.input, f)).toEqual({
        state: "unknown",
      });
      expect(() =>
        requireCanonicalCompletion({ state: "unknown" }, proposal),
      ).toThrow(/outcome is unknown/);
      const restarted = new RequestRecoveryStore({
        getItem: (k) => f.storage.get(k) ?? null,
        setItem: (k, v) => {
          f.storage.set(k, v);
        },
      });
      expect(
        await executeCanonicalAction(f.input, {
          read: f.read,
          recovery: restarted,
        }),
      ).toEqual({ state: "unknown" });
      expect(f.execute).toHaveBeenCalledTimes(1);
      const saved = restarted.executionFor(
        f.input.connection.rpcEndpoint,
        proposal,
      )!;
      expect(() => restarted.acknowledgeSeparateRequest(saved.key)).toThrow(
        /do not resubmit/,
      );
    },
  );
  it("retains unknown after lost network response and permits only read reconciliation", async () => {
    const f = fixture();
    f.execute.mockRejectedValue(Error("response lost"));
    expect(await executeCanonicalAction(f.input, f)).toEqual({
      state: "unknown",
    });
    f.read.mockResolvedValue({ ...f.review, status: 2 });
    expect(await executeCanonicalAction(f.input, f)).toEqual({
      state: "confirmed",
    });
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["envelopeHash", "payloadHash", "document"] as const)(
    "rejects a different immutable %s before sending",
    async (field) => {
      const f = fixture();
      f.read.mockResolvedValue({
        ...f.review,
        [field]: "different",
        status: 2,
      });
      await expect(executeCanonicalAction(f.input, f)).rejects.toThrow(
        /exact canonical action/,
      );
      expect(f.execute).not.toHaveBeenCalled();
    },
  );
  it("rejects an action kind mismatch even if local metadata claims execution", async () => {
    const f = fixture();
    f.read.mockResolvedValue({
      ...f.review,
      status: 2,
      binding: { ...f.review.binding, actionKind: 14 },
    });
    await expect(executeCanonicalAction(f.input, f)).rejects.toThrow(
      /exact canonical action/,
    );
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("requires pinned owned finalized canonical reader success before writing", async () => {
    const f = fixture();
    f.read.mockRejectedValue(Error("wrong owner/PDA/genesis"));
    await expect(executeCanonicalAction(f.input, f)).rejects.toThrow(/genesis/);
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("does not convert a mismatched post-submit finalized account into completion", async () => {
    const f = fixture();
    f.read.mockResolvedValueOnce(f.review).mockResolvedValueOnce({
      ...f.review,
      status: 2,
      payloadHash: "d".repeat(64),
    });
    expect(await executeCanonicalAction(f.input, f)).toEqual({
      state: "submitted",
      txid,
    });
    expect(
      f.recovery.executionFor(f.input.connection.rpcEndpoint, proposal),
    ).toBeDefined();
  });
  it("allows confirmation only for the exact action read at finalized after submission", async () => {
    const f = fixture();
    f.read
      .mockResolvedValueOnce(f.review)
      .mockResolvedValueOnce({ ...f.review, status: 2 });
    expect(await executeCanonicalAction(f.input, f)).toEqual({
      state: "confirmed",
      txid,
    });
    expect(f.recovery.snapshot()).toHaveLength(0);
  });
  it("does not submit unapproved, cancelled or lifecycle-invalid actions", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ ...f.review, status: 0 });
    expect(await executeCanonicalAction(f.input, f)).toEqual({
      state: "waiting",
    });
    expect(f.execute).not.toHaveBeenCalled();
    f.read.mockResolvedValue({ ...f.review, status: 3 });
    await expect(executeCanonicalAction(f.input, f)).rejects.toThrow(
      /not approved/,
    );
    f.input.assertCurrent.mockImplementation(() => {
      throw Error("unmounted");
    });
    await expect(executeCanonicalAction(f.input, f)).rejects.toThrow(
      /unmounted/,
    );
    expect(f.execute).not.toHaveBeenCalled();
  });
  it("admits at most one send while a previous response is deferred", async () => {
    const f = fixture();
    let finish!: (value: unknown) => void;
    f.execute.mockImplementation(
      () =>
        new Promise((r) => {
          finish = r;
        }),
    );
    const pending = executeCanonicalAction(f.input, f);
    await vi.waitFor(() => expect(f.execute).toHaveBeenCalledTimes(1));
    expect(await executeCanonicalAction(f.input, f)).toEqual({
      state: "unknown",
    });
    finish({ txid, proposal, path: paths[12] });
    await pending;
    expect(f.execute).toHaveBeenCalledTimes(1);
  });
  it.each(["valid", "malformed", "lost"])(
    "stale identity after deferred %s execution cannot complete local success",
    async (shape) => {
      const f = fixture();
      let current = true;
      f.input.assertCurrent.mockImplementation(() => {
        if (!current) throw Error("unmounted");
      });
      let resolve!: (value: unknown) => void, reject!: (error: Error) => void;
      f.execute.mockImplementation(
        () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const pending = executeCanonicalAction(f.input, f);
      await vi.waitFor(() => expect(f.execute).toHaveBeenCalledOnce());
      current = false;
      if (shape === "lost") reject(Error("response lost"));
      else
        resolve(shape === "valid" ? { txid, proposal, path: paths[12] } : {});
      await expect(pending).rejects.toThrow(/unmounted/);
      expect(
        f.recovery.executionFor(f.input.connection.rpcEndpoint, proposal),
      ).toBeDefined();
    },
  );
  it("stale identity during finalized post-read cannot claim completion or clear durable record", async () => {
    const f = fixture();
    let current = true;
    f.input.assertCurrent.mockImplementation(() => {
      if (!current) throw Error("unmounted");
    });
    let resolve!: (value: typeof f.review) => void;
    f.read.mockResolvedValueOnce(f.review).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = executeCanonicalAction(f.input, f);
    await vi.waitFor(() => expect(f.read).toHaveBeenCalledTimes(2));
    current = false;
    resolve({ ...f.review, status: 2 });
    await expect(pending).rejects.toThrow(/unmounted/);
    expect(
      f.recovery.executionFor(f.input.connection.rpcEndpoint, proposal)
        ?.outcome,
    ).toBe("submitted");
  });
  it("an already executed different action/wallet cannot satisfy this caller", async () => {
    const f = fixture();
    f.read.mockResolvedValue({ ...f.review, status: 2 });
    await expect(
      executeCanonicalAction({ ...f.input, expectedActionKind: 14 }, f),
    ).rejects.toThrow(/different action or wallet/);
    await expect(
      executeCanonicalAction({ ...f.input, expectedWallet: "different" }, f),
    ).rejects.toThrow(/different action or wallet/);
    expect(f.execute).not.toHaveBeenCalled();
  });
});
