import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  bind: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
  submit: vi.fn(),
  review: {
    reviewId: "reviewed",
    status: 0,
    binding: { approvers: [] },
    envelopeHash: "envelope",
    payloadHash: "payload",
    document: "shown document",
  },
}));
vi.mock("react", () => ({ useRef: () => ({ current: false }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.review, isError: false, refetch: vi.fn() }),
  useMutation: (config: unknown) => config,
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "fixture" } }),
  useWallet: () => ({
    pickSigner: () => new PublicKey(new Uint8Array(32).fill(8)),
  }),
}));
vi.mock("@/lib/hooks/useProposalSubscription", () => ({
  useProposalSubscription: () => {},
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({
    signTypedDescriptor: mocks.sign,
    signDescriptor: vi.fn(),
  }),
}));
vi.mock("@/lib/clearsign/readProposalReview", () => ({
  readCanonicalProposalReview: mocks.read,
}));
vi.mock("@/lib/clearsign/proposalReview", () => ({
  bindApprovalDescriptor: mocks.bind,
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { approveTypedProposal: mocks.prepare },
    submit: { approveTypedProposal: mocks.submit },
  },
}));
import { useProposalWorkflow as createWorkflowFixture } from "@/lib/hooks/useProposalWorkflow";
function action() {
  return (
    createWorkflowFixture("Example", "proposal").approveMutation as unknown as {
      mutationFn: (id?: string) => Promise<unknown>;
    }
  ).mutationFn;
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(mocks.review);
  mocks.prepare.mockResolvedValue({ expiry: 1800000000 });
  mocks.sign.mockResolvedValue({ signature: "synthetic" });
  mocks.submit.mockResolvedValue({ ok: true });
});
describe("production approval workflow with mocked chain/backend/wallet boundaries", () => {
  it("uses the displayed fingerprint and exact document, rechecking before signing and submission", async () => {
    await action()("reviewed");
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(mocks.bind).toHaveBeenCalledOnce();
    expect(mocks.sign).toHaveBeenCalledWith(
      { expiry: 1800000000 },
      expect.objectContaining({
        expectedTyped: {
          envelopeHash: "envelope",
          payloadHash: "payload",
          signableText: "shown document",
        },
      }),
    );
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it.each([undefined, "different"])(
    "does not prepare or sign without the displayed review %s",
    async (id) => {
      await expect(action()(id)).rejects.toThrow(/review/);
      expect(mocks.prepare).not.toHaveBeenCalled();
      expect(mocks.sign).not.toHaveBeenCalled();
    },
  );
  it.each([1, 2, 3])(
    "stops when chain state changes at read %s",
    async (stage) => {
      for (let n = 1; n < stage; n++)
        mocks.read.mockResolvedValueOnce(mocks.review);
      mocks.read.mockResolvedValueOnce({
        ...mocks.review,
        reviewId: "changed",
      });
      await expect(action()("reviewed")).rejects.toThrow(/changed/);
      expect(mocks.submit).not.toHaveBeenCalled();
      if (stage < 3) expect(mocks.sign).not.toHaveBeenCalled();
    },
  );
  it("rejects a prepare mismatch before opening a wallet prompt", async () => {
    mocks.bind.mockImplementation(() => {
      throw Error("descriptor mismatch");
    });
    await expect(action()("reviewed")).rejects.toThrow(/mismatch/);
    expect(mocks.sign).not.toHaveBeenCalled();
  });
  it("does not submit a rejected signature and permits an explicit retry", async () => {
    const run = action();
    mocks.sign.mockRejectedValueOnce(Error("wallet rejected"));
    await expect(run("reviewed")).rejects.toThrow(/rejected/);
    expect(mocks.submit).not.toHaveBeenCalled();
    await run("reviewed");
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("rejects repeated calls while the wallet prompt is pending", async () => {
    let done!: (v: unknown) => void;
    mocks.sign.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    const run = action(),
      first = run("reviewed");
    await vi.waitFor(() => expect(mocks.sign).toHaveBeenCalledOnce());
    await expect(run("reviewed")).rejects.toThrow(/already/);
    done({ signature: "synthetic" });
    await first;
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
});
