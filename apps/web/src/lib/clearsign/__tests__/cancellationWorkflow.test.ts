import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
const m = vi.hoisted(() => ({
  read: vi.fn(),
  bind: vi.fn(),
  prepare: vi.fn(),
  sign: vi.fn(),
  submit: vi.fn(),
  endpoint: "fixture",
  subject: "user-a",
  cursor: 0,
  cleanup: undefined as undefined | (() => void),
  refs: [] as { current: unknown }[],
}));
vi.mock("react", () => ({
  useEffect: (effect: () => () => void) => {
    m.cleanup = effect();
  },
  useRef: (value: unknown) =>
    m.refs[m.cursor++] ?? (m.refs[m.cursor - 1] = { current: value }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ refetch: vi.fn() }),
  useMutation: (config: unknown) => config,
}));
vi.mock("@/lib/wallet", () => ({
  useConnection: () => ({ connection: { rpcEndpoint: m.endpoint } }),
  useWallet: () => ({
    sessionSubject: m.subject,
    pickSigner: (members: string[]) =>
      members[0] ? new PublicKey(members[0]) : null,
  }),
}));
vi.mock("@/lib/hooks/useProposalSubscription", () => ({
  useProposalSubscription: () => {},
}));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({
  useSignWithWallet: () => ({
    signTypedDescriptor: m.sign,
    signDescriptor: m.sign,
  }),
}));
vi.mock("@/lib/clearsign/cancellationReview", () => ({
  readCancellationContext: m.read,
  bindCancellationDescriptor: m.bind,
}));
vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { cancelTypedProposal: m.prepare, cancelProposal: m.prepare },
    submit: { cancelTypedProposal: m.submit, cancelProposal: m.submit },
  },
}));
import { useProposalWorkflow as renderWorkflow } from "@/lib/hooks/useProposalWorkflow";
const signer = new PublicKey(new Uint8Array(32).fill(8)).toBase58();
const context = {
  fingerprint: "unchanged",
  proposal: { typed: true, cancellationBitmap: 0 },
  intent: { approvers: [signer] },
};
function action() {
  m.cursor = 0;
  return (
    renderWorkflow("Example", "proposal").cancelMutation as unknown as {
      mutationFn: () => Promise<unknown>;
    }
  ).mutationFn;
}
beforeEach(() => {
  vi.resetAllMocks();
  m.refs = [];
  m.cursor = 0;
  m.endpoint = "fixture";
  m.subject = "user-a";
  m.read.mockResolvedValue(context);
  m.prepare.mockResolvedValue({ expiry: 1900000000 });
  m.sign.mockResolvedValue({ signature: "synthetic" });
  m.submit.mockResolvedValue({ ok: true });
});
describe("production cancellation workflow with mocked boundaries", () => {
  it.each([true, false])(
    "binds typed=%s target and rechecks authority before signing and submit",
    async (typed) => {
      m.read.mockResolvedValue({
        ...context,
        proposal: { ...context.proposal, typed },
      });
      await action()();
      expect(m.read).toHaveBeenCalledTimes(3);
      expect(m.bind).toHaveBeenCalledOnce();
      expect(m.sign).toHaveBeenCalledOnce();
      expect(m.submit).toHaveBeenCalledOnce();
    },
  );
  it("never opens a wallet for substituted cancellation details", async () => {
    m.bind.mockImplementation(() => {
      throw new Error("wrong target");
    });
    await expect(action()()).rejects.toThrow("wrong target");
    expect(m.sign).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it.each([2, 3])("stops on changed snapshot at read %s", async (read) => {
    for (let i = 1; i < read; i++) m.read.mockResolvedValueOnce(context);
    m.read.mockResolvedValueOnce({ ...context, fingerprint: "changed" });
    await expect(action()()).rejects.toThrow(/changed/);
    if (read === 2) expect(m.sign).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it.each(["subject", "endpoint"] as const)(
    "stops when %s switches during preparation",
    async (field) => {
      m.prepare.mockImplementation(async () => {
        m[field] = "changed";
        action();
        return { expiry: 1900000000 };
      });
      await expect(action()()).rejects.toThrow(
        /Account, network or request changed/,
      );
      expect(m.sign).not.toHaveBeenCalled();
      expect(m.submit).not.toHaveBeenCalled();
    },
  );
  it("does not sign after the request page unmounts during preparation", async () => {
    m.prepare.mockImplementation(async () => {
      m.cleanup?.();
      return { expiry: 1900000000 };
    });
    await expect(action()()).rejects.toThrow(
      /Account, network or request changed/,
    );
    expect(m.sign).not.toHaveBeenCalled();
    expect(m.submit).not.toHaveBeenCalled();
  });
  it("does not prepare another cancellation for an already-voted member", async () => {
    m.read.mockResolvedValue({
      ...context,
      proposal: { ...context.proposal, cancellationBitmap: 1 },
    });
    await expect(action()()).rejects.toThrow(/repeating/);
    expect(m.prepare).not.toHaveBeenCalled();
  });
  it("does not submit a rejected wallet signature and permits a fresh retry", async () => {
    const cancel = action();
    m.sign.mockRejectedValueOnce(new Error("Rejected"));
    await expect(cancel()).rejects.toThrow("Rejected");
    expect(m.submit).not.toHaveBeenCalled();
    await cancel();
    expect(m.submit).toHaveBeenCalledOnce();
  });
  it("blocks concurrent repeated clicks", async () => {
    let resume!: (value: typeof context) => void;
    m.read.mockReturnValueOnce(
      new Promise((resolve) => {
        resume = resolve;
      }),
    );
    const cancel = action(),
      first = cancel();
    await expect(cancel()).rejects.toThrow(/already in progress/);
    resume(context);
    await first;
    expect(m.submit).toHaveBeenCalledOnce();
  });
});
