import { beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { backendApi } from "@/lib/api/endpoints";
import { approveIfNeeded } from "@/lib/chain/approveIfNeeded";
import { waitForProposalApproval } from "@/lib/chain/proposals";
import { completeGovernedProposal } from "@/lib/hooks/completeGovernedProposal";

vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    prepare: { approveProposal: vi.fn() },
    submit: { approveProposal: vi.fn() },
    executeProposal: vi.fn(),
  },
}));
vi.mock("@/lib/chain/approveIfNeeded", () => ({
  approveIfNeeded: vi.fn(),
}));
vi.mock("@/lib/chain/proposals", () => ({
  waitForProposalApproval: vi.fn(),
}));

const signerPk = new PublicKey("11111111111111111111111111111111");
const connection = {} as Parameters<typeof completeGovernedProposal>[0]["connection"];
const signDescriptor = vi.fn();

describe("completeGovernedProposal", () => {
  beforeEach(() => vi.clearAllMocks());

  it("leaves a two-signer proposal pending after only one approval", async () => {
    vi.mocked(approveIfNeeded).mockResolvedValue({
      needsApproveSignature: false,
      readyToExecute: false,
      status: null,
    });
    vi.mocked(waitForProposalApproval).mockResolvedValue(false);

    const result = await run();

    expect(result).toBe("awaiting_approvals");
    expect(backendApi.executeProposal).not.toHaveBeenCalled();
  });

  it("submits a missing approval and executes only after chain approval", async () => {
    vi.mocked(approveIfNeeded).mockResolvedValue({
      needsApproveSignature: true,
      readyToExecute: false,
      status: null,
    });
    vi.mocked(waitForProposalApproval).mockResolvedValue(true);
    vi.mocked(backendApi.prepare.approveProposal).mockResolvedValue({
      message_hex: "00",
      expiry: 42,
    } as never);
    signDescriptor.mockResolvedValue({ signer_pubkey: "first", signature: "aa" });

    const result = await run();

    expect(result).toBe("executed");
    expect(backendApi.submit.approveProposal).toHaveBeenCalledOnce();
    expect(backendApi.executeProposal).toHaveBeenCalledWith(
      "wallet",
      "proposal",
      {},
    );
  });
});

function run() {
  return completeGovernedProposal({
    connection,
    walletName: "wallet",
    proposal: "proposal",
    approvers: ["first", "second"],
    approverPubkey: "first",
    approvalThreshold: 2,
    signerPk,
    signDescriptor,
  });
}
