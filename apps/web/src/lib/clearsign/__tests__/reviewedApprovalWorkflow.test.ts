import { beforeEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { requestRecovery } from "../requestRecovery";
import { PublicKey } from "@solana/web3.js";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  owned: vi.fn(),
  bind: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
  submit: vi.fn(),
  review: {
    reviewId: "reviewed",
    status: 0,
    proposalAddress: "11111111111111111111111111111111",
    threshold: 1,
    binding: {
      approvers: [] as string[],
      approvalBitmap: 0,
      wallet: "wallet",
      intent: "intent",
      index: 1n,
    },
    envelopeHash: "envelope",
    payloadHash: "payload",
    document: "shown document",
  },
}));
vi.mock("react", () => ({
  useRef: (value: unknown) => ({ current: value }),
  useEffect: () => {},
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: mocks.review, isError: false, refetch: vi.fn() }),
  useMutation: (config: unknown) => config,
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: "fixture" } }),
  useWallet: () => ({
    pickSigner: (members: readonly string[]) =>
      members[0] ? new PublicKey(members[0]) : null,
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
vi.mock("@/lib/clearsign/cancellationReview", () => ({
  readOwnedProposalContext: mocks.owned,
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
    createWorkflowFixture("Example", "11111111111111111111111111111111")
      .approveMutation as unknown as {
      mutationFn: (id?: string) => Promise<unknown>;
    }
  ).mutationFn;
}
beforeEach(() => {
  vi.resetAllMocks();
  for (const entry of requestRecovery.votesFor(
    "fixture",
    "11111111111111111111111111111111",
  ))
    requestRecovery.resolveVote(entry.key);
  mocks.review.binding.approvers = [
    new PublicKey(new Uint8Array(32).fill(8)).toBase58(),
  ];
  mocks.review.binding.approvalBitmap = 0;
  mocks.read.mockResolvedValue(mocks.review);
  mocks.owned.mockImplementation(async () => ({
    address: mocks.review.proposalAddress,
    walletName: "Example",
    chainIdentity: "fixture-genesis:fixture-program",
    fingerprint: "owned",
    proposal: {
      typed: true,
      wallet: "wallet",
      intent: "intent",
      proposalIndex: 1n,
      envelopeHash: "envelope",
      payloadHash: "payload",
      approvalBitmap: mocks.review.binding.approvalBitmap,
      cancellationBitmap: 0,
    },
    intent: {
      approvers: mocks.review.binding.approvers,
      approvalThreshold: 1,
      cancellationThreshold: 1,
    },
  }));
  mocks.prepare.mockResolvedValue({ expiry: 1800000000 });
  mocks.sign.mockResolvedValue({ signature: "synthetic" });
  mocks.submit.mockResolvedValue({
    txid: bs58.encode(new Uint8Array(64).fill(8)),
    action: "typed_approve",
    approver_index: 0,
  });
});
describe("production approval workflow with mocked chain/backend/wallet boundaries", () => {
  it("returns unknown for empty submission and blocks blind repeated approval", async () => {
    mocks.submit.mockResolvedValue({});
    await expect(action()("reviewed")).resolves.toMatchObject({
      state: "unknown",
      vote: "approve",
    });
    await expect(action()("reviewed")).rejects.toThrow(/may already/);
    expect(mocks.submit).toHaveBeenCalledOnce();
  });
  it("returns submitted rather than recorded while finalized actor bitmap is still absent", async () => {
    await expect(action()("reviewed")).resolves.toMatchObject({
      state: "submitted",
      vote: "approve",
    });
  });
  it("returns confirmed only after finalized matching actor vote, with read-only recovery support", async () => {
    await action()("reviewed");
    const initial = await mocks.owned();
    mocks.owned.mockResolvedValue({
      ...initial,
      proposal: { ...initial.proposal, approvalBitmap: 1 },
    });
    const check = (
      createWorkflowFixture("Example", "11111111111111111111111111111111")
        .checkVotesMutation as unknown as { mutationFn: () => Promise<unknown> }
    ).mutationFn;
    await expect(check()).resolves.toEqual([
      expect.objectContaining({ state: "confirmed", vote: "approve" }),
    ]);
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(
      requestRecovery.votesFor("fixture", "11111111111111111111111111111111"),
    ).toEqual([]);
  });
  it("selects an unvoted connected member instead of repeating the preferred member's approval", async () => {
    const second = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
    mocks.review.binding.approvers.push(second);
    mocks.review.binding.approvalBitmap = 1;
    await action()("reviewed");
    expect(mocks.prepare).toHaveBeenCalledWith(
      "Example",
      "11111111111111111111111111111111",
      {
        actor_pubkey: second,
      },
    );
  });
  it("does not prepare another approval when all connected members already approved", async () => {
    mocks.review.binding.approvalBitmap = 1;
    await expect(action()("reviewed")).rejects.toThrow(
      /None of your connected wallets/,
    );
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
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
