import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  executeSolanaSend,
  type ExecuteSolanaSendInput,
} from "@/features/send/infrastructure/executeSolanaSend";
import { SendRecovery } from "@/features/send/infrastructure/sendRecovery";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { findTypedProposalAddress } from "@/lib/msig/pda";
import { formatTimestamp } from "@/lib/msig/datetime";
import { ProposalStatus } from "@/lib/msig";

const api = vi.hoisted(() => ({
  prepare: vi.fn(),
  submit: vi.fn(),
  execute: vi.fn(),
  status: vi.fn(),
  decision: vi.fn(),
}));
// Synthetic backend summary boundary; client validation and descriptor verification stay real.
vi.mock("@/lib/api/client", () => ({
  apiRequest: async () => ({
    version: 4,
    kind: "send",
    actionKindCode: 1,
    payloadHash: "bb".repeat(32),
    envelopeHash: "cc".repeat(32),
    canonicalIntentHash: "dd".repeat(32),
    canonicalIntentHex: "abcd",
    policyCommitment: "aa".repeat(32),
    signableText: [
      "ClearSig Approval",
      "ACTION\nSend 1 SOL",
      "DETAILS\nAmount: 1 SOL",
      "POLICY\nDisplay profile: clearsig-full-v2@1\nProtocol: clearsig-intent-v4@1",
      "RISK\nVerify destination",
      "PURPOSE\nTransfer",
    ].join("\n\n"),
  }),
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { createTypedProposal: api.prepare },
    submit: { createTypedProposal: api.submit },
    executeTypedSolSend: api.execute,
  },
}));
vi.mock("@/lib/policies/enforce", () => ({
  resolvePolicyEnforcement: async () => ({ evaluation: { matched: false } }),
  assertPolicyNotDenied: () => {},
}));
vi.mock("@/lib/policies/persistentWalletPolicy", () => ({
  resolvePersistentSendPolicy: async () => null,
}));
vi.mock("@/lib/retail/policyEvaluation", () => ({
  evaluatePolicy: () => ({ ok: true }),
  PolicyViolationError: class extends Error {},
}));
vi.mock("@/lib/clearsign/fiatEstimate", () => ({
  liveUsdEstimate: () => undefined,
}));
vi.mock("@/lib/chain/approveIfNeeded", () => ({
  approveIfNeeded: api.decision,
}));
vi.mock("@/features/send/infrastructure/solanaProposalStatus", () => ({
  waitForSolanaProposalStatus: api.status,
  isProposalNotApprovedError: () => false,
}));
const signer = new PublicKey(new Uint8Array(32).fill(7));
const intent = new PublicKey(new Uint8Array(32).fill(8));
const destination = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const proposal = findTypedProposalAddress(
  intent,
  6n,
  CLEAR_WALLET_PROGRAM_ID,
)[0].toBase58();
const txid = bs58.encode(new Uint8Array(64).fill(4));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fixture() {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
  const recovery = new SendRecovery("synthetic-devnet-wallet", storage);
  const attempt = recovery.begin();
  const sign = vi.fn().mockResolvedValue({ signature: "synthetic" });
  const input = {
    attempt,
    wallet: { publicKey: signer, isLedger: false, pickSigner: () => signer },
    connection: {},
    signTypedDescriptor: sign,
    firstIntent: {
      account: {
        intentIndex: 0,
        approvalThreshold: 1,
        proposers: [signer.toBase58()],
        approvers: [signer.toBase58()],
      },
    },
    walletPda: signer,
    walletName: "Treasury",
    amount: "1",
    numericAmount: 1,
    note: "",
    resolved: { kind: "address", address: destination },
    budgetUsage: { spentUsd: 0, perChain: [] },
    setPhase: vi.fn(),
  } as unknown as ExecuteSolanaSendInput;
  return { recovery, attempt, input, sign, storage };
}
beforeEach(() => {
  vi.clearAllMocks();
  api.prepare.mockImplementation(async (_name, request) => {
    const expiry = Math.floor(
      Date.parse(request.expiry.replace(" ", "T") + "Z") / 1000,
    );
    const descriptor = {
      ...request,
      action: "proposal_typed_create",
      wallet_name: "Treasury",
      wallet_pubkey: signer.toBase58(),
      intent_pubkey: intent.toBase58(),
      proposal_index: 6,
      proposal_pubkey: proposal,
      signer_pubkey: signer.toBase58(),
      approval_requirement: 1,
      approval_count_after: 1,
      approval_kind: "approvals",
      policy_commitment_hex: request.policy_commitment,
      payload_hash_hex: request.payload_hash,
      envelope_hash_hex: request.envelope_hash,
      message_flavor: "clearsign_v4_document",
      expiry,
    };
    const text = [
      request.signable_text,
      "",
      "APPROVAL",
      "Decision: PROPOSE",
      "Proposal: #6",
      "Wallet: Treasury",
      `Requested by: ${signer.toBase58()}`,
      "Requirement: 1 approval",
      "Status if accepted: 1 of 1 approval",
      "",
      "EXPIRY",
      `${formatTimestamp(expiry)} UTC`,
      "",
      "PROOF",
      "ClearSign: v4",
      `Envelope: ${request.envelope_hash}`,
    ].join("\n");
    return { ...descriptor, message_hex: Buffer.from(text).toString("hex") };
  });
  api.submit.mockResolvedValue({ proposal });
  api.decision.mockResolvedValue({
    needsApproveSignature: false,
    status: ProposalStatus.Approved,
  });
  api.status.mockResolvedValue(ProposalStatus.Approved);
  api.execute.mockResolvedValue({
    proposal,
    txid,
    path: "typed_sol_send",
    recipient: destination,
    amount_lamports: 1_000_000_000,
  });
});
describe("native SOL orchestration (synthetic RPC/wallet; real canonical and recovery helpers)", () => {
  it.each(["unmount", "wallet ABA"])(
    "prevents writes when deferred signature resolves after %s",
    async (change) => {
      const f = fixture();
      const signed = deferred<{ signature: string }>();
      f.sign.mockReturnValue(signed.promise);
      const operation = executeSolanaSend(f.input);
      await vi.waitFor(() => expect(f.sign).toHaveBeenCalledOnce());
      if (change === "unmount") f.recovery.unmount();
      else {
        f.recovery.scope("other");
        f.recovery.scope("synthetic-devnet-wallet");
      }
      signed.resolve({ signature: "synthetic" });
      await expect(operation).rejects.toThrow("Wallet or network changed");
      expect(api.submit).not.toHaveBeenCalled();
      expect(api.execute).not.toHaveBeenCalled();
      expect(f.recovery.saved()).toBeNull();
      f.attempt.finish();
    },
  );
  it.each(["network error", "missing receipt"])(
    "retains the derived request on create %s and blocks duplicate after reload",
    async (outcome) => {
      const f = fixture();
      api.submit.mockImplementation(async () => {
        expect(f.recovery.saved()).toEqual({ proposal, outcome: "unknown" });
        if (outcome === "network error") throw new Error("response lost");
        return {};
      });
      await expect(executeSolanaSend(f.input)).rejects.toThrow();
      f.attempt.finish();
      expect(f.recovery.saved()).toEqual({ proposal, outcome: "unknown" });
      expect(() =>
        new SendRecovery("synthetic-devnet-wallet", f.storage).begin(),
      ).toThrow("existing request");
      expect(api.submit).toHaveBeenCalledOnce();
      expect(api.execute).not.toHaveBeenCalled();
    },
  );
  it("returns submission evidence without claiming finality or clearing recovery", async () => {
    const f = fixture();
    const result = await executeSolanaSend(f.input);
    f.attempt.finish();
    expect(result).toEqual({ proposal, executedTxid: txid });
    expect(result).not.toHaveProperty("confirmed");
    expect(result).not.toHaveProperty("executed", true);
    expect(f.recovery.saved()).toEqual({
      proposal,
      outcome: "submitted",
      txid,
    });
    expect(api.execute).toHaveBeenCalledExactlyOnceWith(
      "Treasury",
      proposal,
      { recipient: destination, amountLamports: 1_000_000_000 },
      { retry: false },
    );
    expect(() => f.recovery.begin()).toThrow("existing request");
  });
  it.each([
    {},
    { txid },
    {
      proposal,
      txid,
      path: "wrong",
      recipient: destination,
      amount_lamports: 1_000_000_000,
    },
  ])(
    "rejects malformed execution receipt %j without retry",
    async (receipt) => {
      const f = fixture();
      api.execute.mockResolvedValue(receipt);
      await expect(executeSolanaSend(f.input)).rejects.toThrow();
      f.attempt.finish();
      expect(f.recovery.saved()?.proposal).toBe(proposal);
      expect(api.execute).toHaveBeenCalledOnce();
      expect(() => f.recovery.begin()).toThrow("existing request");
    },
  );
  it("does not execute while finalized status is still Active", async () => {
    const f = fixture();
    api.status.mockResolvedValue(ProposalStatus.Active);
    expect(await executeSolanaSend(f.input)).toEqual({
      proposal,
      executedTxid: null,
      awaitingApprovers: true,
    });
    expect(api.execute).not.toHaveBeenCalled();
    expect(f.recovery.saved()?.proposal).toBe(proposal);
    f.attempt.finish();
  });
  it("preserves an accepted create response after unmount without executing", async () => {
    const f = fixture();
    const response = deferred<{ proposal: string }>();
    api.submit.mockReturnValue(response.promise);
    const operation = executeSolanaSend(f.input);
    await vi.waitFor(() => expect(api.submit).toHaveBeenCalledOnce());
    f.recovery.unmount();
    response.resolve({ proposal });
    await expect(operation).rejects.toThrow("Wallet or network changed");
    expect(f.recovery.saved()).toEqual({ proposal, outcome: "submitted" });
    expect(api.execute).not.toHaveBeenCalled();
    f.attempt.finish();
  });
  it("executes the exact signed decimal amount despite floating point rounding", async () => {
    const f = fixture();
    f.input.amount = "8388608.000000001";
    f.input.numericAmount = Number(f.input.amount);
    api.execute.mockResolvedValue({
      proposal,
      txid,
      path: "typed_sol_send",
      recipient: destination,
      amount_lamports: 8388608000000001,
    });
    await executeSolanaSend(f.input);
    expect(api.execute).toHaveBeenCalledWith(
      "Treasury",
      proposal,
      { recipient: destination, amountLamports: 8388608000000001 },
      { retry: false },
    );
    f.attempt.finish();
  });
  it.each(["0.0000000001", "9007199.254740992", "0", "-1"])(
    "rejects unsupported decimal %s before signing or creating",
    async (amount) => {
      const f = fixture();
      f.input.amount = amount;
      f.input.numericAmount = Number(amount);
      await expect(executeSolanaSend(f.input)).rejects.toThrow(
        "positive SOL amount",
      );
      expect(f.sign).not.toHaveBeenCalled();
      expect(api.prepare).not.toHaveBeenCalled();
      expect(api.submit).not.toHaveBeenCalled();
      expect(api.execute).not.toHaveBeenCalled();
      f.attempt.finish();
    },
  );
});
