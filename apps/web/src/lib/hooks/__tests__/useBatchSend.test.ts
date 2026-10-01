import bs58 from "bs58";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicKey } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProposalStatus } from "@/lib/msig";
import { listBatches, useBatchSend } from "../useBatchSend";

const mocks = vi.hoisted(() => ({
  fetchWallet: vi.fn(),
  fetchIntent: vi.fn(),
  pickSigner: vi.fn(),
  enforcePolicy: vi.fn(),
  persistentPolicy: vi.fn(),
  clearSign: vi.fn(),
  prepareCreate: vi.fn(),
  sign: vi.fn(),
  submitCreate: vi.fn(),
  approvalDecision: vi.fn(),
  prepareApprove: vi.fn(),
  submitApprove: vi.fn(),
  fetchProposal: vi.fn(),
  execute: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/lib/wallet", () => ({
  useWallet: () => ({ pickSigner: mocks.pickSigner }),
  useConnection: () => ({ connection: { rpcEndpoint: "mock://batch" } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: {
      createTypedProposal: mocks.prepareCreate,
      approveTypedProposal: mocks.prepareApprove,
    },
    submit: {
      createTypedProposal: mocks.submitCreate,
      approveTypedProposal: mocks.submitApprove,
    },
    executeTypedSolBatchSend: mocks.execute,
  },
}));
vi.mock("@/lib/api/errors", () => ({
  friendlyError: (error: Error) => ({ title: error.message }),
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({ signTypedDescriptor: mocks.sign }),
}));
vi.mock("@/lib/chain/wallets", () => ({
  fetchWalletByName: mocks.fetchWallet,
}));
vi.mock("@/lib/chain/intents", () => ({ fetchIntent: mocks.fetchIntent }));
vi.mock("@/lib/chain/proposals", () => ({
  fetchProposal: mocks.fetchProposal,
}));
vi.mock("@/lib/chain/approveIfNeeded", () => ({
  approveIfNeeded: mocks.approvalDecision,
}));
vi.mock("@/lib/clearsign", () => ({
  prepareClearSignV4Action: mocks.clearSign,
  clearSignProfileForSigner: () => "web",
}));
vi.mock("@/lib/policies/enforce", () => ({
  resolvePolicyEnforcement: mocks.enforcePolicy,
  assertPolicyNotDenied: vi.fn(),
}));
vi.mock("@/lib/policies/persistentWalletPolicy", () => ({
  resolvePersistentSendPolicy: mocks.persistentPolicy,
}));

// Cancellation tests mock verification; inlineApproval.test.ts exercises its real binding.
vi.mock("@/lib/clearsign/inlineApproval", () => ({
  reviewedCreationProposalAddress: () => "11111111111111111111111111111111",
  assertSubmittedCreation: (
    _creation: unknown,
    _expected: unknown,
    proposal: unknown,
  ) => proposal,
  inlineApprovalOptions: (
    _creation: unknown,
    _approval: unknown,
    expected: {
      envelopeHash: string;
      payloadHash: string;
      signableText: string;
    },
    _proposal: string,
    signer: PublicKey,
  ) => ({
    preferSigner: signer,
    expectedTyped: {
      envelopeHash: expected.envelopeHash,
      payloadHash: expected.payloadHash,
      signableText: expected.signableText,
    },
  }),
}));

const signer = new PublicKey("11111111111111111111111111111111");
const executionTxid = bs58.encode(new Uint8Array(64).fill(9));
const proposal = "11111111111111111111111111111111";
const walletData = { pda: signer };
const intentData = {
  account: {
    proposers: [signer.toBase58()],
    approvers: [signer.toBase58()],
    approvalThreshold: 1,
  },
};
const summary = {
  actionKindCode: 1,
  policyCommitment: "policy",
  payloadHash: "payload",
  envelopeHash: "envelope",
  signableText: "Exact trusted signing text",
  canonicalIntentHex: "abcd",
};
const dry = {
  expiry: "2026-10-01 00:00:00",
  intent_index: 0,
  action_kind: 1,
  policy_commitment_hex: "policy",
  payload_hash_hex: "payload",
  envelope_hash_hex: "envelope",
  action_id: "action",
  nonce: "nonce",
  canonical_intent_hex: "abcd",
};
const signed = { signer_pubkey: signer.toBase58(), signature: "signature" };
const approved = {
  status: ProposalStatus.Approved,
  needsApproveSignature: false,
  readyToExecute: true,
};
const needsApproval = {
  status: ProposalStatus.Active,
  needsApproveSignature: true,
  readyToExecute: false,
};
function args() {
  return {
    walletName: "vault",
    intentIndex: 0,
    rows: [
      {
        label: "Recipient",
        destination: signer.toBase58(),
        lamports: "1000000001",
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
// Use React's real refs/callbacks, capturing the hook without requiring a browser DOM.
function hook() {
  let actions!: ReturnType<typeof useBatchSend>;
  function Harness() {
    actions = useBatchSend();
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return actions;
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const entry of [...requestRecovery.snapshot()]) {
    if (entry.phase === "execution")
      requestRecovery.resolveExecution(entry.endpoint, entry.proposal);
    else requestRecovery.acknowledgeSeparateRequest(entry.key);
  }
  mocks.fetchWallet.mockResolvedValue(walletData);
  mocks.fetchIntent.mockResolvedValue(intentData);
  mocks.pickSigner.mockReturnValue(signer);
  mocks.enforcePolicy.mockResolvedValue({});
  mocks.persistentPolicy.mockResolvedValue(null);
  mocks.clearSign.mockResolvedValue(summary);
  mocks.prepareCreate.mockResolvedValue(dry);
  mocks.sign.mockResolvedValue(signed);
  mocks.submitCreate.mockResolvedValue({ proposal });
  mocks.approvalDecision.mockResolvedValue(approved);
  mocks.prepareApprove.mockResolvedValue(dry);
  mocks.submitApprove.mockResolvedValue({});
  mocks.fetchProposal.mockResolvedValue({ status: ProposalStatus.Approved });
  mocks.execute.mockResolvedValue({
    txid: executionTxid,
    proposal,
    path: "typed_sol_batch_send",
  });
  mocks.invalidate.mockResolvedValue(undefined);
  const storage = new Map<string, string>();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("batch send cancellation and admission", () => {
  it.each([
    ["wallet lookup", mocks.fetchWallet, walletData, mocks.fetchIntent],
    ["intent lookup", mocks.fetchIntent, intentData, mocks.enforcePolicy],
    ["policy checks", mocks.enforcePolicy, {}, mocks.persistentPolicy],
    ["persistent policy lookup", mocks.persistentPolicy, null, mocks.clearSign],
    ["ClearSign preparation", mocks.clearSign, summary, mocks.prepareCreate],
    ["proposal preparation", mocks.prepareCreate, dry, mocks.sign],
    ["proposal signature", mocks.sign, signed, mocks.submitCreate],
  ] as const)(
    "stops after cancellation during %s",
    async (_label, pendingMock, value, nextMock) => {
      const pending = deferred<unknown>();
      pendingMock.mockReturnValueOnce(pending.promise);
      const actions = hook();
      const work = actions.sendBatch(args());
      await vi.waitFor(() => expect(pendingMock).toHaveBeenCalledOnce());
      actions.cancel();
      pending.resolve(value);
      const result = await work;
      expect(nextMock).not.toHaveBeenCalled();
      expect(mocks.submitCreate).not.toHaveBeenCalled();
      expect(mocks.submitApprove).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        succeeded: 0,
        failed: 1,
        proposalPdas: [],
        outcome: "cancelled",
      });
      expect(listBatches()).toEqual([]);
    },
  );
  it("rejects same-tick duplicate entry before the first RPC finishes", async () => {
    const pending = deferred<typeof walletData>();
    mocks.fetchWallet.mockReturnValueOnce(pending.promise);
    const actions = hook();
    const first = actions.sendBatch(args());
    await expect(actions.sendBatch(args())).rejects.toThrow(
      "already in progress",
    );
    expect(mocks.fetchWallet).toHaveBeenCalledOnce();
    pending.resolve(walletData);
    await expect(first).resolves.toMatchObject({
      succeeded: 1,
      failed: 0,
      outcome: "execution_submitted",
    });
    expect(mocks.submitCreate).toHaveBeenCalledOnce();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("reset cannot clear cancellation or release a still-running batch", async () => {
    const pending = deferred<typeof signed>();
    mocks.sign.mockReturnValueOnce(pending.promise);
    const actions = hook();
    const first = actions.sendBatch(args());
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    actions.cancel();
    actions.reset();
    await expect(actions.sendBatch(args())).rejects.toThrow(
      "already in progress",
    );
    pending.resolve(signed);
    await expect(first).resolves.toMatchObject({ outcome: "cancelled" });
    expect(mocks.submitCreate).not.toHaveBeenCalled();
    actions.reset();
    await expect(actions.sendBatch(args())).resolves.toMatchObject({
      outcome: "execution_submitted",
    });
    expect(mocks.submitCreate).toHaveBeenCalledOnce();
  });
  it.each([mocks.fetchWallet, mocks.sign])(
    "releases admission after a pre-submit failure and permits retry",
    async (failedMock) => {
      failedMock.mockRejectedValueOnce(new Error("Unavailable"));
      const actions = hook();
      await expect(actions.sendBatch(args())).resolves.toMatchObject({
        succeeded: 0,
        failed: 1,
        outcome: "failed",
      });
      await expect(actions.sendBatch(args())).resolves.toMatchObject({
        succeeded: 1,
        failed: 0,
        outcome: "execution_submitted",
      });
      expect(mocks.submitCreate).toHaveBeenCalledOnce();
    },
  );
  it("uses an immutable row snapshot throughout preparation and execution", async () => {
    const pending = deferred<typeof walletData>();
    mocks.fetchWallet.mockReturnValueOnce(pending.promise);
    const input = args();
    const work = hook().sendBatch(input);
    input.rows[0]!.lamports = "999";
    input.rows.push({
      label: "Late edit",
      destination: signer.toBase58(),
      lamports: "42",
    });
    pending.resolve(walletData);
    await expect(work).resolves.toMatchObject({ succeeded: 1 });
    expect(mocks.clearSign.mock.calls[0]![0].payload.recipients).toEqual([
      {
        recipient: signer.toBase58(),
        recipientEncoding: "solana_pubkey",
        amount: "1.000000001",
        asset: "SOL",
      },
    ]);
    expect(mocks.execute).toHaveBeenCalledWith(
      "vault",
      proposal,
      {
        payments: [
          { recipient: signer.toBase58(), amountLamports: 1_000_000_001 },
        ],
      },
      { retry: false },
    );
  });
  it("rejects oversized input before RPC and permits a valid retry", async () => {
    const actions = hook();
    const input = args();
    await expect(
      actions.sendBatch({
        ...input,
        rows: Array.from({ length: 17 }, () => input.rows[0]!),
      }),
    ).rejects.toThrow("16 recipients");
    expect(mocks.fetchWallet).not.toHaveBeenCalled();
    await expect(actions.sendBatch(input)).resolves.toMatchObject({
      outcome: "execution_submitted",
    });
  });
});

describe("batch send cancellation after a consequential call", () => {
  it("waits for an in-flight proposal, records it and stops further approval/execution", async () => {
    const pending = deferred<{ proposal: string }>();
    mocks.submitCreate.mockReturnValueOnce(pending.promise);
    const actions = hook();
    const work = actions.sendBatch(args());
    await vi.waitFor(() => expect(mocks.submitCreate).toHaveBeenCalledOnce());
    actions.cancel();
    await expect(actions.sendBatch(args())).rejects.toThrow(
      "already in progress",
    );
    pending.resolve({ proposal });
    const result = await work;
    expect(result).toMatchObject({
      succeeded: 1,
      failed: 0,
      proposalPdas: [proposal],
      outcome: "created",
    });
    expect(result.message).toContain("already submitted");
    expect(mocks.approvalDecision).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(listBatches()).toHaveLength(1);
    expect(listBatches()[0]?.proposalPdas).toEqual([proposal]);
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["proposals", "vault"],
    });
  });
  it.each([
    [
      "approval decision",
      mocks.approvalDecision,
      needsApproval,
      mocks.prepareApprove,
    ],
    ["approval preparation", mocks.prepareApprove, dry, mocks.submitApprove],
    ["approval submission", mocks.submitApprove, {}, mocks.fetchProposal],
    [
      "approval status read",
      mocks.fetchProposal,
      { status: ProposalStatus.Approved },
      mocks.execute,
    ],
  ] as const)(
    "preserves the proposal and stops after cancellation during %s",
    async (_label, pendingMock, value, nextMock) => {
      const pending = deferred<unknown>();
      mocks.approvalDecision.mockResolvedValue(needsApproval);
      pendingMock.mockReturnValueOnce(pending.promise);
      const actions = hook();
      const work = actions.sendBatch(args());
      await vi.waitFor(() => expect(pendingMock).toHaveBeenCalledOnce());
      actions.cancel();
      pending.resolve(value);
      await expect(work).resolves.toMatchObject({
        succeeded: 1,
        failed: 0,
        proposalPdas: [proposal],
        outcome: "created",
      });
      expect(nextMock).not.toHaveBeenCalled();
      expect(mocks.execute).not.toHaveBeenCalled();
    },
  );
  it("does not submit an approval signed after cancellation", async () => {
    const pending = deferred<typeof signed>();
    mocks.approvalDecision.mockResolvedValue(needsApproval);
    mocks.sign
      .mockResolvedValueOnce(signed)
      .mockReturnValueOnce(pending.promise);
    const actions = hook();
    const work = actions.sendBatch(args());
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledTimes(2));
    actions.cancel();
    pending.resolve(signed);
    await expect(work).resolves.toMatchObject({
      outcome: "created",
      proposalPdas: [proposal],
    });
    expect(mocks.submitApprove).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("does not describe an in-flight execution as reversed by cancellation", async () => {
    const pending = deferred<Record<string, unknown>>();
    mocks.execute.mockReturnValueOnce(pending.promise);
    const actions = hook();
    const work = actions.sendBatch(args());
    await vi.waitFor(() => expect(mocks.execute).toHaveBeenCalledOnce());
    actions.cancel();
    actions.reset();
    await expect(actions.sendBatch(args())).rejects.toThrow(
      "already in progress",
    );
    pending.resolve({
      txid: executionTxid,
      proposal,
      path: "typed_sol_batch_send",
    });
    await expect(work).resolves.toMatchObject({
      succeeded: 1,
      failed: 0,
      outcome: "execution_submitted",
    });
  });
  it("reports an unknown submission outcome instead of claiming cancellation prevented it", async () => {
    const pending = deferred<{ proposal: string }>();
    mocks.submitCreate.mockReturnValueOnce(pending.promise);
    const actions = hook();
    const work = actions.sendBatch(args());
    await vi.waitFor(() => expect(mocks.submitCreate).toHaveBeenCalledOnce());
    actions.cancel();
    pending.reject(new Error("Response lost"));
    const result = await work;
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 0,
      outcome: "submission_unknown",
    });
    expect(result.message).toContain("Check Activity before retrying");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("retains a created proposal when approval or execution fails", async () => {
    mocks.execute.mockRejectedValueOnce(new Error("RPC unavailable"));
    await expect(hook().sendBatch(args())).resolves.toMatchObject({
      succeeded: 1,
      failed: 0,
      outcome: "execution_unknown",
      proposalPdas: [proposal],
    });
    expect(listBatches()).toHaveLength(1);
  });
  it("passes trusted signing fields through unchanged", async () => {
    await hook().sendBatch(args());
    expect(mocks.sign).toHaveBeenCalledWith(dry, {
      preferSigner: signer,
      expectedTyped: {
        envelopeHash: summary.envelopeHash,
        payloadHash: summary.payloadHash,
        signableText: summary.signableText,
      },
    });
    expect(mocks.submitCreate).toHaveBeenCalledWith("vault", {
      ...signed,
      expiry: dry.expiry,
      intent_index: dry.intent_index,
      action_kind: dry.action_kind,
      policy_commitment: dry.policy_commitment_hex,
      payload_hash: dry.payload_hash_hex,
      envelope_hash: dry.envelope_hash_hex,
      action_id: dry.action_id,
      nonce: dry.nonce,
      policyBytesHex: undefined,
      canonical_intent_hex: dry.canonical_intent_hex,
    });
  });
  it.each([
    {},
    { txid: "" },
    { txid: "not-a-signature" },
    { txid: executionTxid, proposal: "wrong", path: "typed_sol_batch_send" },
    { txid: executionTxid, proposal, path: "different_action" },
  ])(
    "preserves saved request on unverified execution response %#",
    async (response) => {
      mocks.execute.mockResolvedValueOnce(response);
      const actions = hook();
      const result = await actions.sendBatch(args());
      expect(result).toMatchObject({
        outcome: "execution_unknown",
        proposalPdas: [proposal],
        failed: 0,
        succeeded: 1,
      });
      expect(result.executionTxid).toBeUndefined();
      const lock = requestRecovery.executionFor("mock://batch", proposal)!;
      expect(lock.outcome).toBe("unknown");
      expect(() =>
        requestRecovery.acknowledgeSeparateRequest(lock.key),
      ).toThrow();
      await actions.sendBatch(args());
      expect(mocks.submitCreate).toHaveBeenCalledOnce();
      expect(mocks.execute).toHaveBeenCalledOnce();
    },
  );
  it("records valid execution submission but never chain confirmation", async () => {
    const result = await hook().sendBatch(args());
    expect(result).toMatchObject({
      outcome: "execution_submitted",
      executionTxid,
      proposalPdas: [proposal],
    });
    expect(result.message).toContain("not confirmation");
    expect(
      requestRecovery.executionFor("mock://batch", proposal)?.outcome,
    ).toBe("submitted");
    expect(mocks.execute).toHaveBeenLastCalledWith(
      "vault",
      proposal,
      expect.any(Object),
      { retry: false },
    );
  });
});
