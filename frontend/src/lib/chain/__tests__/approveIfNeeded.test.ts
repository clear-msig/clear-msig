import { describe, expect, it } from "vitest";
import { ProposalStatus } from "@/lib/msig";
import { approvalDecisionForProposal } from "@/lib/chain/approveIfNeeded";

describe("approvalDecisionForProposal", () => {
  const approvers = ["first", "second"];

  it("does not execute an active two-approver proposal after only the first vote", () => {
    const decision = approvalDecisionForProposal(
      { status: ProposalStatus.Active, approvalBitmap: 0b01 },
      {
        approvers,
        approverPubkey: "first",
        approvalThreshold: 2,
      },
    );

    expect(decision.needsApproveSignature).toBe(false);
    expect(decision.readyToExecute).toBe(false);
  });

  it("requests the connected second approver's missing vote", () => {
    const decision = approvalDecisionForProposal(
      { status: ProposalStatus.Active, approvalBitmap: 0b01 },
      {
        approvers,
        approverPubkey: "second",
        approvalThreshold: 2,
      },
    );

    expect(decision.needsApproveSignature).toBe(true);
    expect(decision.readyToExecute).toBe(false);
  });

  it("allows execution only after the program reports Approved", () => {
    const decision = approvalDecisionForProposal(
      { status: ProposalStatus.Approved, approvalBitmap: 0b11 },
      { approvers, approvalThreshold: 2 },
    );

    expect(decision.needsApproveSignature).toBe(false);
    expect(decision.readyToExecute).toBe(true);
  });
});
