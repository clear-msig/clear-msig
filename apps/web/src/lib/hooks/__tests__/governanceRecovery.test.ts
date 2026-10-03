import { parseIntent, type IntentAccount } from "@/lib/msig/accounts";
import bs58 from "bs58";
import { findIntentAddress } from "@/lib/msig/pda";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
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
    actionKindCode: 5,
    policyCommitment: "aa".repeat(32),
    envelopeHash: "cc".repeat(32),
    payloadHash: "bb".repeat(32),
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
vi.mock("@/lib/intents/generatedRegistry", () => ({
  INTENT_TEMPLATES: [
    { chainKind: 0, template: "", file: "send-sol" },
    { chainKind: 0, template: "", file: "send-sol-alternate" },
  ],
}));
let expectedIntent: IntentAccount;
const pk = new PublicKey("11111111111111111111111111111111");
function input(): TypedGovernanceInput {
  return {
    requestIdentity: {
      accountKey: "aa".repeat(32),
      assertCurrent: mocks.assert,
    },
    connection: {
      rpcEndpoint: "mock://governance",
      getGenesisHash: async () => "genesis",
      getMultipleAccountsInfoAndContext: async () => ({
        context: { slot: 1 },
        value: [null, null],
      }),
    } as unknown as Connection,
    walletName: "Ops",
    walletId: pk.toBase58(),
    voteIntentIndex: 0,
    voteApprovers: [pk.toBase58()],
    voteApprovalThreshold: 1,
    targetIntentIndex: 1,
    expectedIntent,
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
  vi.stubEnv("NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH", "genesis");
  for (const entry of requestRecovery.snapshot()) {
    if (entry.phase === "execution")
      requestRecovery.resolveExecution(entry.endpoint, entry.proposal);
    else requestRecovery.acknowledgeSeparateRequest(entry.key);
  }
  const [, bump] = findIntentAddress(pk, 1, CLEAR_WALLET_PROGRAM_ID);
  const one = Buffer.from([1, 0, 0, 0]);
  const body = Buffer.concat([
    pk.toBuffer(),
    Buffer.from([bump, 1, 3, 0, 1, 1, 1]),
    Buffer.alloc(14),
    one,
    pk.toBuffer(),
    one,
    pk.toBuffer(),
    Buffer.alloc(28),
  ]);
  expectedIntent = parseIntent(Buffer.concat([Buffer.from([2]), body]));
  mocks.update.mockResolvedValue({
    params_data_hex: "01" + body.toString("hex"),
  });
  mocks.prepare.mockResolvedValue({
    proposal_pubkey: pk.toBase58(),
    expiry: 1900000000,
  });
  mocks.sign.mockResolvedValue({ signature: "mock" });
  mocks.submit.mockResolvedValue({ proposal: pk.toBase58() });
  mocks.wait.mockResolvedValue(false);
  mocks.execute.mockResolvedValue({
    txid: bs58.encode(new Uint8Array(64).fill(9)),
    proposal: pk.toBase58(),
    path: "typed_intent_governance",
    action_kind: 5,
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
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
      "outcome unknown",
    );
    expect(requestRecovery.snapshot()[0].outcome).toBe("submitted");
  });
  it("retains both recovery locks when txid exists but finalized target is unverified", async () => {
    vi.useFakeTimers();
    try {
      mocks.wait.mockResolvedValue(true);
      const pending = expect(completeTypedGovernance(input())).rejects.toThrow(
        "verification pending",
      );
      await vi.advanceTimersByTimeAsync(3000);
      await pending;
      expect(requestRecovery.snapshot()).toHaveLength(2);
      await expect(completeTypedGovernance(input())).rejects.toThrow(
        "already created",
      );
      expect(mocks.submit).toHaveBeenCalledTimes(1);
      expect(mocks.execute).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it("rejects a compiler response with changed threshold before any signing", async () => {
    const changed = { ...input(), approvalThreshold: 2 };
    await expect(completeTypedGovernance(changed)).rejects.toThrow(
      "reviewed authority settings",
    );
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.submit).not.toHaveBeenCalled();
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

it("blocks unsupported custom definitions before preparation or signing", async () => {
  await expect(
    completeTypedGovernance({
      ...input(),
      expectedIntent: {
        ...expectedIntent,
        template: "unregistered custom rule",
      },
    }),
  ).rejects.toThrow("no compatible registered template");
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.sign).not.toHaveBeenCalled();
});
it("checks alternate registered definitions when identical display text has different executable bytes", async () => {
  mocks.update.mockResolvedValueOnce({ params_data_hex: "00" });
  await expect(completeTypedGovernance(input())).resolves.toMatchObject({
    kind: "awaiting_approvals",
  });
  expect(mocks.update).toHaveBeenCalledTimes(2);
  expect(mocks.update.mock.calls[1][1].file).toBe("send-sol-alternate");
});
