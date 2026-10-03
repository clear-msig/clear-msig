import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntentType } from "@/lib/msig";
import type {
  PendingRecurringExecution,
  ProSchedule,
} from "@/lib/pro/treasury";
import { useRecurringSchedulesController } from "./useRecurringSchedulesController";

const mocks = vi.hoisted(() => ({
  generation: 0,
  journal: [] as ProSchedule[],
  review: vi.fn(),
  schedule: vi.fn(),
  upsert: vi.fn(),
  refetch: vi.fn(),
  sign: vi.fn(),
  prepare: vi.fn(),
  create: vi.fn(),
  clearSign: vi.fn(),
  executeSol: vi.fn(),
  executeToken: vi.fn(),
  executeAsset: vi.fn(),
  pay: vi.fn(),
  tokenAccounts: vi.fn(),
  rows: [] as ProSchedule[],
  states: {} as Record<string, unknown>,
}));
const address = new PublicKey(new Uint8Array(32).fill(1));
const proposalAddress = new PublicKey(new Uint8Array(32).fill(2)).toBase58();
// Identity boundary is synthetic; the production controller and recovery transitions are real.
vi.mock("@/lib/hooks/useRequestIdentity", () => ({
  useRequestIdentity: () => ({
    capture: () => {
      const generation = mocks.generation;
      return {
        assertCurrent: () => {
          if (generation !== mocks.generation)
            throw new Error("Identity changed");
        },
      };
    },
  }),
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "fixture" } }),
  useWallet: () => ({ pickSigner: () => address }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) =>
    queryKey[0] === "wallet"
      ? { data: { pda: address, account: { intentIndex: 3 } } }
      : queryKey[0] === "wallet-intents"
        ? {
            data: [
              {
                pda: address,
                account: {
                  intentType: IntentType.Custom,
                  chainKind: 0,
                  approved: true,
                  proposers: [address.toBase58()],
                  approvalThreshold: 2,
                  intentIndex: 3,
                },
              },
            ],
          }
        : {
            get data() {
              return mocks.states;
            },
            refetch: mocks.refetch,
          },
}));
vi.mock("@/lib/pro/treasury", () => ({
  useProSchedules: () => ({
    rows: mocks.rows,
    upsert: mocks.upsert,
    remove: vi.fn(),
  }),
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({ signTypedDescriptor: mocks.sign }),
}));
vi.mock("@/lib/clearsign", () => ({
  prepareClearSignV4Action: mocks.clearSign,
  clearSignProfileForSigner: () => "web",
}));
vi.mock("@/lib/policies/persistentWalletPolicy", () => ({
  resolvePersistentAssetPolicy: async () => null,
  resolvePersistentSendPolicy: async () => null,
}));
vi.mock("@/features/treasury/infrastructure/recurringTokenAccounts", () => ({
  resolveRecurringUsdcAccounts: mocks.tokenAccounts,
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { createTypedProposal: mocks.prepare },
    submit: { createTypedProposal: mocks.create },
    executeTypedRecurringSchedule: mocks.executeSol,
    executeTypedRecurringTokenSchedule: mocks.executeToken,
    executeTypedRecurringAssetSchedule: mocks.executeAsset,
    executeRecurringPayment: mocks.pay,
  },
}));

vi.mock("@/lib/clearsign/inlineApproval", () => ({
  reviewedCreationProposalAddress: () =>
    new PublicKey(new Uint8Array(32).fill(2)).toBase58(),
  assertSubmittedCreation: (
    _dry: unknown,
    _expected: unknown,
    value: unknown,
  ) => {
    if (value !== new PublicKey(new Uint8Array(32).fill(2)).toBase58())
      throw new Error("Missing submitted proposal identity");
  },
}));
vi.mock("@/lib/clearsign/readProposalReview", () => ({
  readCanonicalProposalReview: mocks.review,
}));
vi.mock("@/features/treasury/infrastructure/recurringState", () => ({
  fetchRecurringSchedule: mocks.schedule,
}));
vi.mock("@/features/treasury/infrastructure/recurringJournal", () => ({
  readRecurringJournal: () => mocks.journal,
  writeRecurringJournal: (_w: string, _e: string, row: ProSchedule) => {
    mocks.journal = [
      row,
      ...mocks.journal.filter((saved) => saved.id !== row.id),
    ];
    return mocks.journal;
  },
}));
function row(): ProSchedule {
  return {
    id: "schedule-1",
    name: "Vendor",
    address: address.toBase58(),
    category: "vendor",
    amount: "1.5",
    asset: "SOL",
    cadence: "Weekly",
    nextRun: "2030-01-01",
    createdAt: 1,
    proposalAddress,
    intervalSeconds: 604800,
    firstExecutionAt: 1000,
    paymentCount: 12,
  };
}
const active = {
  address: address.toBase58(),
  amountRaw: 1500000000n,
  intervalSeconds: 604800,
  status: "active",
  nextExecutionAt: 2000,
  remainingPayments: 9,
  executedPayments: 3,
  asset: "SOL",
  recipient: address.toBase58(),
  intent: address.toBase58(),
  policyVersion: "CSP1",
};
function controller() {
  let result!: ReturnType<typeof useRecurringSchedulesController>;
  function Harness() {
    result = useRecurringSchedulesController("treasury");
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return result;
}
function pending(status: 1 | 2 = 2): PendingRecurringExecution {
  return {
    version: 1,
    scheduleId: "schedule-1",
    proposalAddress,
    status,
    asset: "SOL",
    recipient: address.toBase58(),
    amount: "1.5",
    intervalSeconds: 604800,
    firstExecutionAt: 2000,
    paymentCount: 9,
    policyVersion: "CSP1",
    envelopeHash: "envelope",
    payloadHash: "payload",
    phase: "created",
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.generation = 0;
  mocks.rows = [];
  mocks.journal = [];
  mocks.review.mockResolvedValue({
    status: 1,
    envelopeHash: "envelope",
    payloadHash: "payload",
    binding: { actionKind: 15 },
    sections: [{ title: "DETAILS", text: "Schedule: schedule-1" }],
  });
  mocks.schedule.mockResolvedValue(active);
  mocks.states = { "schedule-1": active };
  mocks.refetch.mockImplementation(async () => ({ data: mocks.states }));
  mocks.upsert.mockImplementation((value: ProSchedule) => {
    mocks.rows = [value];
  });
  mocks.sign.mockResolvedValue({ signature: "signed" });
  mocks.prepare.mockResolvedValue({ expiry: "2030-01-01", intent_index: 3 });
  mocks.create.mockResolvedValue({ proposal: proposalAddress });
  mocks.clearSign.mockResolvedValue({
    actionKindCode: 1,
    policyCommitment: "policy",
    payloadHash: "payload",
    envelopeHash: "envelope",
    signableText: "exact prepared text",
    canonicalIntentHex: "abcd",
  });
  mocks.executeSol.mockResolvedValue({});
  mocks.executeAsset.mockResolvedValue({});
  mocks.executeToken.mockResolvedValue({});
  mocks.tokenAccounts.mockResolvedValue({
    mint: address.toBase58(),
    sourceToken: address.toBase58(),
    destinationToken: proposalAddress,
    recipientOwner: address.toBase58(),
  });
});

const txid = bs58.encode(new Uint8Array(64).fill(3));
describe("recurring evidence and durable recovery", () => {
  it("persists the exact revocation request before create and waits for approvals", async () => {
    mocks.review.mockResolvedValue({
      status: 0,
      envelopeHash: "envelope",
      payloadHash: "payload",
      binding: { actionKind: 15 },
      sections: [{ title: "DETAILS", text: "Schedule: schedule-1" }],
    });
    mocks.create.mockImplementation(async () => {
      expect(mocks.journal[0].pendingExecution?.phase).toBe("creating");
      return { proposal: proposalAddress };
    });
    await controller().revoke(row());
    expect(mocks.journal[0].pendingExecution).toMatchObject({
      phase: "created",
      status: 2,
      firstExecutionAt: 2000,
      paymentCount: 9,
    });
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });
  it("blocks legacy records without independently saved commitments", async () => {
    const saved = {
      ...row(),
      pendingExecution: { ...pending(), envelopeHash: undefined },
    };
    await expect(controller().retry(saved)).rejects.toThrow(
      "no saved canonical commitment",
    );
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });
  it("does not equate an empty execute response with completion or repeat unknown submission", async () => {
    const saved = { ...row(), pendingExecution: pending() };
    await expect(controller().retry(saved)).rejects.toThrow(
      "transaction signature",
    );
    expect(mocks.journal[0].pendingExecution?.phase).toBe("attempted");
    await expect(controller().retry(saved)).rejects.toThrow(
      "No repeat transaction",
    );
    expect(mocks.executeSol).toHaveBeenCalledOnce();
  });
  it("retains valid submission until matching finalized proposal execution", async () => {
    mocks.executeSol.mockResolvedValue({ txid, proposal: proposalAddress });
    const saved = { ...row(), pendingExecution: pending() };
    await expect(controller().retry(saved)).rejects.toThrow(
      "finalized verification remains pending",
    );
    expect(mocks.journal[0].pendingExecution?.txid).toBe(txid);
    mocks.review.mockResolvedValue({
      status: 2,
      envelopeHash: "envelope",
      payloadHash: "payload",
      binding: { actionKind: 15 },
      sections: [{ title: "DETAILS", text: "Schedule: schedule-1" }],
    });
    await controller().retry(saved);
    expect(mocks.journal[0].pendingExecution).toBeUndefined();
    expect(mocks.executeSol).toHaveBeenCalledOnce();
  });
  it("rejects unrelated finalized commitments before clearing recovery", async () => {
    mocks.review.mockResolvedValue({
      status: 2,
      envelopeHash: "wrong",
      payloadHash: "payload",
      binding: { actionKind: 15 },
      sections: [{ title: "DETAILS", text: "Schedule: schedule-1" }],
    });
    await expect(
      controller().retry({ ...row(), pendingExecution: pending() }),
    ).rejects.toThrow("does not match");
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });
  it("retains unknown Pay now outcome until exact finalized counter advancement", async () => {
    mocks.pay.mockResolvedValue({});
    await expect(controller().pay(row())).rejects.toThrow(
      "transaction signature",
    );
    expect(mocks.journal[0].pendingPayment?.executedPayments).toBe(3);
    await expect(controller().pay(row())).rejects.toThrow("not yet verified");
    expect(mocks.pay).toHaveBeenCalledOnce();
    mocks.schedule.mockResolvedValue({
      ...active,
      executedPayments: 4,
      remainingPayments: 8,
    });
    await controller().retry(row());
    expect(mocks.journal[0].pendingPayment).toBeUndefined();
  });
  it("retains deterministic creation recovery when response omits proposal identity", async () => {
    mocks.create.mockResolvedValue({});
    await expect(controller().revoke(row())).rejects.toThrow(
      "Missing submitted",
    );
    expect(mocks.journal[0].pendingExecution?.phase).toBe("creating");
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });
  it.each(["CSP1", "CSP2"] as const)(
    "retains %s USDC execution routing without retries",
    async (policyVersion) => {
      const saved = {
        ...row(),
        pendingExecution: {
          ...pending(),
          asset: "USDC" as const,
          policyVersion,
          mint: address.toBase58(),
          sourceToken: address.toBase58(),
          destinationToken: proposalAddress,
          recipientOwner: address.toBase58(),
        },
      };
      const execute =
        policyVersion === "CSP1" ? mocks.executeToken : mocks.executeAsset;
      execute.mockResolvedValue({ txid, proposal: proposalAddress });
      await expect(controller().retry(saved)).rejects.toThrow(
        "finalized verification remains pending",
      );
      expect(execute).toHaveBeenCalledWith(
        "treasury",
        proposalAddress,
        expect.objectContaining({ amountTokens: 1500000 }),
        { retry: false },
      );
      expect(mocks.executeSol).not.toHaveBeenCalled();
    },
  );
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
describe("recurring identity boundary (synthetic invalidation)", () => {
  it("does not submit a signature returned after identity invalidation", async () => {
    const signed = deferred<{ signature: string }>();
    mocks.sign.mockReturnValue(signed.promise);
    const operation = controller().revoke(row());
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    mocks.generation++;
    signed.resolve({ signature: "late" });
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.executeSol).not.toHaveBeenCalled();
    expect(mocks.journal).toEqual([]);
  });
  it("does not open a wallet popup when preparation outlives its identity", async () => {
    const prepared = deferred<Record<string, unknown>>();
    mocks.prepare.mockReturnValue(prepared.promise);
    const operation = controller().revoke(row());
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledOnce());
    mocks.generation++;
    prepared.resolve({ expiry: "2030-01-01", intent_index: 3 });
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("preserves accepted creation after invalidation without executing it", async () => {
    const created = deferred<{ proposal: string }>();
    mocks.create.mockReturnValue(created.promise);
    const operation = controller().revoke(row());
    await vi.waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(mocks.journal[0].pendingExecution?.phase).toBe("creating");
    mocks.generation++;
    created.resolve({ proposal: proposalAddress });
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.journal[0].pendingExecution?.phase).toBe("created");
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });
  it("stops execution when canonical re-read outlives the identity", async () => {
    const read = deferred<unknown>();
    mocks.review.mockReturnValue(read.promise);
    const operation = controller().retry({
      ...row(),
      pendingExecution: pending(),
    });
    await vi.waitFor(() => expect(mocks.review).toHaveBeenCalledOnce());
    mocks.generation++;
    read.resolve({
      status: 1,
      envelopeHash: "envelope",
      payloadHash: "payload",
      binding: { actionKind: 15 },
      sections: [{ title: "DETAILS", text: "Schedule: schedule-1" }],
    });
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.executeSol).not.toHaveBeenCalled();
  });
  it("retains known execution signature after identity changes during POST", async () => {
    const response = deferred<unknown>();
    mocks.executeSol.mockReturnValue(response.promise);
    const operation = controller().retry({
      ...row(),
      pendingExecution: pending(),
    });
    await vi.waitFor(() => expect(mocks.executeSol).toHaveBeenCalledOnce());
    mocks.generation++;
    response.resolve({ proposal: proposalAddress, txid });
    await expect(operation).rejects.toThrow("Identity changed");
    expect(mocks.journal[0].pendingExecution).toMatchObject({
      phase: "attempted",
      txid,
    });
  });
});
