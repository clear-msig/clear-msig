import { describe, expect, it } from "vitest";
import { isProposalNotApprovedError } from "@/features/send/infrastructure/solanaProposalStatus";

describe("Solana proposal execution errors", () => {
  it.each([
    "ProposalNotApproved",
    "proposal is not in an approved state",
    "custom program error: 0x1775",
  ])("recognizes an approval race from %s", (message) => {
    expect(isProposalNotApprovedError(new Error(message))).toBe(true);
  });

  it("reads structured backend stderr", () => {
    expect(
      isProposalNotApprovedError({
        payload: { stderr: "custom program error: 0x1775" },
      }),
    ).toBe(true);
  });

  it("does not classify unrelated execution failures", () => {
    expect(isProposalNotApprovedError(new Error("RPC unavailable"))).toBe(false);
  });
});
