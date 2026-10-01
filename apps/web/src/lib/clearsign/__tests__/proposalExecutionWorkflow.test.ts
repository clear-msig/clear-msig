import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
const m = vi.hoisted(() => ({
  read: vi.fn(),
  canonical: vi.fn(),
  execute: vi.fn(),
  native: vi.fn(),
  refs: [] as { current: unknown }[],
  cursor: 0,
}));
vi.mock("react", () => ({
  useEffect: (fn: () => unknown) => {
    fn();
  },
  useRef: (value: unknown) =>
    m.refs[m.cursor++] ?? (m.refs[m.cursor - 1] = { current: value }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { reviewId: "reviewed" }, refetch: vi.fn() }),
  useMutation: (c: unknown) => c,
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "execution-test" } }),
  useWallet: () => ({ sessionSubject: "synthetic", publicKey: null }),
}));
vi.mock("@/lib/hooks/useProposalSubscription", () => ({
  useProposalSubscription: () => {},
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({}),
}));
vi.mock("@/lib/clearsign/cancellationReview", () => ({
  readOwnedProposalContext: m.read,
}));
vi.mock("@/lib/clearsign/readProposalReview", () => ({
  readCanonicalProposalReview: m.canonical,
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    executeTypedIntentGovernance: m.execute,
    executeTypedProposal: m.execute,
    executeProposal: m.execute,
    executeTypedSolSend: m.native,
  },
}));
import { useProposalWorkflow as renderWorkflow } from "@/lib/hooks/useProposalWorkflow";
import { requestRecovery } from "../requestRecovery";
const address = "11111111111111111111111111111111",
  txid = bs58.encode(new Uint8Array(64).fill(8));
const context = {
  proposal: { typed: true, actionKind: 3, status: 1 },
  intent: { intentType: 3, chainKind: 0 },
};
const nativeReview = {
  reviewId: "reviewed",
  status: 1,
  binding: { actionKind: 1 },
  network: "Solana Devnet",
  headline: "Send 0.3 SOL",
  sections: [{ title: "DETAILS", text: `Amount: 0.3 SOL\nTo: ${address}` }],
};
function workflow() {
  m.cursor = 0;
  return renderWorkflow("Example", address);
}
function execute() {
  return (
    workflow().executeMutation as unknown as {
      mutationFn: (input: object) => Promise<{ state: string }>;
    }
  ).mutationFn({});
}
function check() {
  return (
    workflow().checkExecutionMutation as unknown as {
      mutationFn: () => Promise<{ state: string }>;
    }
  ).mutationFn();
}
beforeEach(() => {
  vi.resetAllMocks();
  m.refs = [];
  m.cursor = 0;
  requestRecovery.resolveExecution("execution-test", address);
  m.read.mockResolvedValue(context);
  m.canonical.mockResolvedValue(nativeReview);
  m.execute.mockResolvedValue({
    txid,
    proposal: address,
    path: "typed_intent_governance",
    action_kind: 3,
  });
});
describe("production proposal execution with synthetic RPC/backend", () => {
  it("keeps valid HTTP/txid response submitted while finalized request remains approved", async () => {
    expect((await execute()).state).toBe("submitted");
    expect(m.execute).toHaveBeenCalledWith(
      "Example",
      address,
      {},
      { retry: false },
    );
    expect(requestRecovery.executionFor("execution-test", address)?.txid).toBe(
      txid,
    );
    await expect(execute()).rejects.toThrow(/may already/);
    expect(m.execute).toHaveBeenCalledOnce();
  });
  it("confirms only after a fresh owned finalized Executed status", async () => {
    m.read
      .mockResolvedValueOnce(context)
      .mockResolvedValueOnce({
        ...context,
        proposal: { ...context.proposal, status: 2 },
      });
    expect((await execute()).state).toBe("confirmed");
    expect(
      requestRecovery.executionFor("execution-test", address),
    ).toBeUndefined();
  });
  it.each([
    {},
    { txid: "bad" },
    {
      txid,
      proposal: "wrong",
      path: "typed_intent_governance",
      action_kind: 3,
    },
  ])(
    "preserves request and blocks blind retry for response %j",
    async (result) => {
      m.execute.mockResolvedValue(result);
      await expect(execute()).rejects.toThrow(/preserved/);
      expect(
        requestRecovery.executionFor("execution-test", address)?.proposal,
      ).toBe(address);
      await expect(execute()).rejects.toThrow(/may already/);
      expect(m.execute).toHaveBeenCalledOnce();
    },
  );
  it("preserves uncertain delivery after a delayed transport failure", async () => {
    m.execute.mockRejectedValue(new Error("Timed out after server dispatch"));
    await expect(execute()).rejects.toThrow(/preserved/);
    expect(
      requestRecovery.executionFor("execution-test", address)?.outcome,
    ).toBe("unknown");
  });
  it("read-only check does not reexecute and only resolves verified terminal state", async () => {
    await execute();
    expect((await check()).state).toBe("unknown");
    expect(
      requestRecovery.executionFor("execution-test", address),
    ).toBeDefined();
    m.read.mockResolvedValue({
      ...context,
      proposal: { ...context.proposal, status: 2 },
    });
    expect((await check()).state).toBe("confirmed");
    expect(
      requestRecovery.executionFor("execution-test", address),
    ).toBeUndefined();
    expect(m.execute).toHaveBeenCalledOnce();
  });
  it("does not dispatch unowned/unverified request context", async () => {
    m.read.mockRejectedValue(new Error("Wrong PDA"));
    await expect(execute()).rejects.toThrow(/Wrong PDA/);
    expect(m.execute).not.toHaveBeenCalled();
    expect(
      requestRecovery.executionFor("execution-test", address),
    ).toBeUndefined();
  });
  it("dispatches exact nativeSOL action-specific executor without automatic retry", async () => {
    m.read.mockResolvedValue({
      ...context,
      proposal: { ...context.proposal, actionKind: 1 },
    });
    m.native.mockResolvedValue({
      txid,
      proposal: address,
      path: "typed_sol_send",
      recipient: address,
      amount_lamports: 300000000,
    });
    expect((await execute()).state).toBe("submitted");
    expect(m.native).toHaveBeenCalledWith(
      "Example",
      address,
      { recipient: address, amountLamports: 300000000 },
      { retry: false },
    );
    expect(m.execute).not.toHaveBeenCalled();
  });
  it("blocks nativeSOL if freshly rechecked signed details changed", async () => {
    m.read.mockResolvedValue({
      ...context,
      proposal: { ...context.proposal, actionKind: 1 },
    });
    m.canonical
      .mockResolvedValueOnce(nativeReview)
      .mockResolvedValueOnce({ ...nativeReview, reviewId: "changed" });
    await expect(execute()).rejects.toThrow(/changed/);
    expect(m.native).not.toHaveBeenCalled();
    expect(
      requestRecovery.executionFor("execution-test", address),
    ).toBeUndefined();
  });
  it("does not pretend unsupported action recovery calls perform the intended action", async () => {
    m.read.mockResolvedValue({
      ...context,
      proposal: { ...context.proposal, actionKind: 9 },
    });
    await expect(execute()).rejects.toThrow(/action-specific recovery/);
    expect(m.execute).not.toHaveBeenCalled();
    expect(
      requestRecovery.executionFor("execution-test", address),
    ).toBeUndefined();
  });
});
