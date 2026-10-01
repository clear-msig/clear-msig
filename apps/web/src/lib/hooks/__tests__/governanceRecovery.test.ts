import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  completeTypedGovernance,
  type TypedGovernanceInput,
} from "../completeTypedGovernance";
import { requestRecovery } from "@/lib/clearsign/requestRecovery";
const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  prepare: vi.fn(),
  submit: vi.fn(),
  wait: vi.fn(),
  execute: vi.fn(),
  sign: vi.fn(),
  assert: vi.fn(),
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { updateIntent: mocks.update, createTypedProposal: mocks.prepare },
    submit: { createTypedProposal: mocks.submit },
    executeTypedIntentGovernance: mocks.execute,
  },
}));
vi.mock("@/lib/chain/approveIfNeeded", () => ({
  approveIfNeeded: async () => ({ needsApproveSignature: false }),
}));
vi.mock("@/lib/chain/proposals", () => ({
  waitForProposalApproval: mocks.wait,
}));
vi.mock("@/lib/clearsign", () => ({
  prepareClearSignV4Action: async () => ({
    envelopeHash: "hash",
    payloadHash: "hash",
    signableText: "independent summary",
    canonicalIntentHex: "abcd",
  }),
  randomActionLabel: () => "replay-label",
}));
// Transport/recovery suite: actual cryptographic binding is covered by inlineApproval.test.ts.
vi.mock("@/lib/clearsign/inlineApproval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/clearsign/inlineApproval")>()),
  reviewedCreationProposalAddress: () => "11111111111111111111111111111111",
  assertSubmittedCreation: (_c: unknown, _e: unknown, p: string) => p,
}));
const pk = new PublicKey("11111111111111111111111111111111");
function input(): TypedGovernanceInput {
  return {
    requestIdentity: {
      accountKey: "aa".repeat(32),
      assertCurrent: mocks.assert,
    },
    connection: { rpcEndpoint: "mock://governance" } as Connection,
    walletName: "Ops",
    walletId: pk.toBase58(),
    voteIntentIndex: 0,
    voteApprovers: [pk.toBase58()],
    voteApprovalThreshold: 1,
    targetIntentIndex: 1,
    proposers: [pk.toBase58()],
    approvers: [pk.toBase58()],
    approvalThreshold: 1,
    cancellationThreshold: 1,
    timelockSeconds: 0,
    templateFile: "send-sol",
    kind: "change_threshold",
    proposerPk: pk,
    signTypedDescriptor: mocks.sign,
    pickApprover: () => pk,
    deviceProfile: { id: "clearsig-full-v1" },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const entry of requestRecovery.snapshot())
    requestRecovery.acknowledgeSeparateRequest(entry.key);
  mocks.update.mockResolvedValue({ params_data_hex: "0102" });
  mocks.prepare.mockResolvedValue({
    proposal_pubkey: pk.toBase58(),
    expiry: 1900000000,
  });
  mocks.sign.mockResolvedValue({ signature: "mock" });
  mocks.submit.mockResolvedValue({ proposal: pk.toBase58() });
  mocks.wait.mockResolvedValue(false);
  mocks.execute.mockResolvedValue({ txid: "synthetic-txid" });
});
describe("actual governance orchestrator with mocked providers", () => {
  it("keeps created awaiting-approval request and blocks creating it again", async () => {
    await expect(completeTypedGovernance(input())).resolves.toEqual({
      kind: "awaiting_approvals",
      proposal: pk.toBase58(),
    });
    await expect(completeTypedGovernance(input())).rejects.toThrow(
      "already created",
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("keeps uncertain identity after lost create response", async () => {
    mocks.submit.mockRejectedValueOnce(new Error("network lost"));
    await expect(completeTypedGovernance(input())).rejects.toThrow(
      "network lost",
    );
    expect(requestRecovery.snapshot()[0].outcome).toBe("unknown");
    await expect(completeTypedGovernance(input())).rejects.toThrow("uncertain");
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("does not report execution completed without transaction evidence", async () => {
    mocks.wait.mockResolvedValue(true);
    mocks.execute.mockResolvedValue({});
    await expect(completeTypedGovernance(input())).rejects.toThrow(
      "no transaction ID",
    );
    expect(requestRecovery.snapshot()[0].outcome).toBe("submitted");
  });
  it("releases recovery after execution response contains transaction identity", async () => {
    mocks.wait.mockResolvedValue(true);
    await expect(completeTypedGovernance(input())).resolves.toMatchObject({
      kind: "executed",
    });
    expect(requestRecovery.snapshot()).toEqual([]);
  });
  it("stops after account switch before submission", async () => {
    mocks.sign.mockImplementation(async () => {
      mocks.assert.mockImplementation(() => {
        throw Error("Account changed");
      });
      return { signature: "mock" };
    });
    await expect(completeTypedGovernance(input())).rejects.toThrow(
      "Account changed",
    );
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(requestRecovery.snapshot()).toEqual([]);
  });
});
