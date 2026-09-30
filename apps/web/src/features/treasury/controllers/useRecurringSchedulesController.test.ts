import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntentType } from "@/lib/msig";
import type { PendingRecurringExecution, ProSchedule } from "@/lib/pro/treasury";
import { useRecurringSchedulesController } from "./useRecurringSchedulesController";

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(), refetch: vi.fn(), sign: vi.fn(), prepare: vi.fn(), create: vi.fn(),
  clearSign: vi.fn(), executeSol: vi.fn(), executeToken: vi.fn(), executeAsset: vi.fn(), pay: vi.fn(),
  tokenAccounts: vi.fn(), rows: [] as ProSchedule[], states: {} as Record<string, unknown>,
}));
const address = new PublicKey(new Uint8Array(32).fill(1));
const proposalAddress = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: {} }), useWallet: () => ({ pickSigner: () => address }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => queryKey[0] === "wallet"
    ? { data: { pda: address, account: { intentIndex: 3 } } }
    : queryKey[0] === "wallet-intents"
      ? { data: [{ pda: address, account: { intentType: IntentType.Custom, chainKind: 0, approved: true, proposers: [address.toBase58()], approvalThreshold: 2, intentIndex: 3 } }] }
      : { get data() { return mocks.states; }, refetch: mocks.refetch },
}));
vi.mock("@/lib/pro/treasury", () => ({ useProSchedules: () => ({ rows: mocks.rows, upsert: mocks.upsert, remove: vi.fn() }) }));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({ useSignWithWallet: () => ({ signTypedDescriptor: mocks.sign }) }));
vi.mock("@/lib/clearsign", () => ({ prepareClearSignV4Action: mocks.clearSign, clearSignProfileForSigner: () => "web" }));
vi.mock("@/lib/policies/persistentWalletPolicy", () => ({ resolvePersistentAssetPolicy: async () => null, resolvePersistentSendPolicy: async () => null }));
vi.mock("@/features/treasury/infrastructure/recurringTokenAccounts", () => ({ resolveRecurringUsdcAccounts: mocks.tokenAccounts }));
vi.mock("@/lib/api/endpoints", () => ({ backendApi: {
  prepare: { createTypedProposal: mocks.prepare }, submit: { createTypedProposal: mocks.create },
  executeTypedRecurringSchedule: mocks.executeSol,
  executeTypedRecurringTokenSchedule: mocks.executeToken,
  executeTypedRecurringAssetSchedule: mocks.executeAsset,
  executeRecurringPayment: mocks.pay,
} }));

function row(): ProSchedule {
  return { id: "schedule-1", name: "Vendor", address: address.toBase58(), category: "vendor", amount: "1.5", asset: "SOL", cadence: "Weekly", nextRun: "2030-01-01", createdAt: 1, proposalAddress, intervalSeconds: 604800, firstExecutionAt: 1000, paymentCount: 12 };
}
const active = { status: "active", nextExecutionAt: 2000, remainingPayments: 9, executedPayments: 3, asset: "SOL", recipient: address.toBase58(), intent: address.toBase58(), policyVersion: "CSP1" };
function controller() {
  let result!: ReturnType<typeof useRecurringSchedulesController>;
  function Harness() { result = useRecurringSchedulesController("treasury"); return null; }
  renderToStaticMarkup(createElement(Harness));
  return result;
}
function pending(status: 1 | 2 = 2): PendingRecurringExecution {
  return { version: 1, scheduleId: "schedule-1", proposalAddress, status, asset: "SOL", recipient: address.toBase58(), amount: "1.5", intervalSeconds: 604800, firstExecutionAt: 2000, paymentCount: 9, policyVersion: "CSP1" };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.rows = [];
  mocks.states = { "schedule-1": active };
  mocks.refetch.mockImplementation(async () => ({ data: mocks.states }));
  mocks.upsert.mockImplementation((value: ProSchedule) => { mocks.rows = [value]; });
  mocks.sign.mockResolvedValue({ signature: "signed" });
  mocks.prepare.mockResolvedValue({ expiry: "2030-01-01", intent_index: 3 });
  mocks.create.mockResolvedValue({ proposal: proposalAddress });
  mocks.clearSign.mockResolvedValue({ actionKindCode: 1, policyCommitment: "policy", payloadHash: "payload", envelopeHash: "envelope", signableText: "exact prepared text", canonicalIntentHex: "abcd" });
  mocks.executeSol.mockResolvedValue({});
  mocks.executeAsset.mockResolvedValue({});
  mocks.executeToken.mockResolvedValue({});
  mocks.tokenAccounts.mockResolvedValue({ mint: address.toBase58(), sourceToken: address.toBase58(), destinationToken: proposalAddress, recipientOwner: address.toBase58() });
});

describe("recurring operation retries", () => {
  it("persists a multi-approval revocation's effective payload and retries it after reload", async () => {
    mocks.executeSol.mockRejectedValueOnce(new Error("ProposalNotApproved"));
    await controller().revoke(row());
    const saved = JSON.parse(JSON.stringify(mocks.rows[0])) as ProSchedule;
    expect(saved.pendingExecution).toMatchObject({ status: 2, firstExecutionAt: 2000, paymentCount: 9, amount: "1.5" });
    expect(mocks.clearSign.mock.calls[0][0].payload).toMatchObject({ status: "revoked", firstExecutionAt: 2000, paymentCount: 9 });
    // Display metadata can change. Retry must use the immutable signed snapshot.
    saved.amount = "99";
    saved.firstExecutionAt = 9999;
    saved.paymentCount = 20;
    mocks.rows = [saved];
    mocks.refetch.mockResolvedValue({ data: { "schedule-1": { ...active, status: "revoked" } } });
    await controller().retry(saved);
    expect(mocks.executeSol).toHaveBeenLastCalledWith("treasury", proposalAddress, {
      scheduleId: "schedule-1", recipient: address.toBase58(), amountLamports: 1500000000,
      intervalSeconds: 604800, firstExecutionAt: 2000, paymentCount: 9, status: 2,
    });
    expect(mocks.rows[0].pendingExecution).toBeUndefined();
    expect(mocks.sign).toHaveBeenCalledOnce();
  });

  it("retains pending metadata on failed retry and permits a later retry", async () => {
    const saved = { ...row(), pendingExecution: pending() };
    mocks.rows = [saved];
    mocks.executeSol.mockRejectedValueOnce(new Error("Still awaiting approval"));
    const actions = controller();
    await expect(actions.retry(saved)).rejects.toThrow("Still awaiting approval");
    expect(mocks.upsert).not.toHaveBeenCalled();
    await actions.retry(saved);
    expect(mocks.executeSol).toHaveBeenCalledTimes(2);
    expect(mocks.rows[0].pendingExecution?.status).toBe(2);
  });

  it("does not reactivate an ambiguous legacy proposal", async () => {
    await expect(controller().retry(row())).rejects.toThrow("no verified retry details");
    expect(mocks.executeSol).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it.each(["CSP1", "CSP2"] as const)("keeps the USDC %s execution adapter after reload", async (policyVersion) => {
    const saved = { ...row(), pendingExecution: { ...pending(), asset: "USDC" as const, policyVersion, mint: address.toBase58(), sourceToken: address.toBase58(), destinationToken: proposalAddress, recipientOwner: address.toBase58(), amount: "1.000001" } };
    await controller().retry(saved);
    const expected = policyVersion === "CSP2" ? mocks.executeAsset : mocks.executeToken;
    const other = policyVersion === "CSP2" ? mocks.executeToken : mocks.executeAsset;
    expect(expected).toHaveBeenCalledWith("treasury", proposalAddress, expect.objectContaining({ status: 2, amountTokens: 1000001, paymentCount: 9, firstExecutionAt: 2000 }));
    expect(other).not.toHaveBeenCalled();
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });

  it("preserves activation metadata when the new schedule needs more approvals", async () => {
    mocks.states = {};
    mocks.executeAsset.mockRejectedValue(new Error("ProposalNotApproved"));
    await controller().configure({ name: "Vendor", recipient: address.toBase58(), amount: "1.000001", asset: "USDC", cadence: "Monthly", firstRun: new Date(Date.now() + 86400000).toISOString(), paymentCount: "12", note: "" });
    expect(mocks.rows[0].pendingExecution).toMatchObject({ version: 1, status: 1, policyVersion: "CSP2", paymentCount: 12, amount: "1.000001" });
    expect(mocks.executeToken).not.toHaveBeenCalled();
  });

  it("prevents a second request while a signature is unresolved", async () => {
    let finish!: (value: object) => void;
    mocks.sign.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const actions = controller();
    const work = actions.revoke(row());
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    await expect(actions.revoke(row())).rejects.toThrow("still running");
    finish({ signature: "signed" });
    await work;
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it("reconciles an already-revoked schedule without repeating execution", async () => {
    mocks.states = { "schedule-1": { ...active, status: "revoked" } };
    await controller().retry({ ...row(), pendingExecution: pending() });
    expect(mocks.executeSol).not.toHaveBeenCalled();
    expect(mocks.rows[0].pendingExecution).toBeUndefined();
  });

  it("blocks replacing or paying a schedule with a pending revocation", async () => {
    const saved = { ...row(), pendingExecution: pending() };
    const actions = controller();
    await expect(actions.revoke(saved)).rejects.toThrow("pending request");
    await expect(actions.pay(saved)).rejects.toThrow("pending schedule request");
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.pay).not.toHaveBeenCalled();
  });
});
