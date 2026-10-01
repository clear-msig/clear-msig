import { describe, expect, it } from "vitest";
import {
  friendlyIntentLabel,
  friendlyStatus,
  proposalActivityTemplate,
} from "../labels";
import { ProposalStatus } from "@/lib/msig";
describe("history action identity", () => {
  it.each(Array.from({ length: 16 }, (_, index) => index + 1))(
    "preserves typed kind %s over its containing intent slot",
    (kind) => {
      const template = proposalActivityTemplate(0, kind);
      expect(template).not.toBe("AddIntent");
      expect(friendlyIntentLabel(template)).not.toMatch(/Custom|Typed/);
      if (kind > 2) {
        expect(friendlyStatus(ProposalStatus.Executed, template)).toBe(
          "Executed",
        );
        expect(friendlyStatus(ProposalStatus.Approved, template)).toBe(
          "Ready to execute",
        );
      }
    },
  );
  it("keeps transfer and legacy metadata labels but never invents a transfer for unknown actions", () => {
    expect(
      friendlyStatus(ProposalStatus.Executed, proposalActivityTemplate(4, 1)),
    ).toBe("Sent");
    expect(proposalActivityTemplate(1)).toBe("RemoveIntent");
    for (const template of [
      undefined,
      "Custom",
      proposalActivityTemplate(4, 99),
    ]) {
      expect(friendlyStatus(ProposalStatus.Executed, template)).toBe(
        "Executed",
      );
      expect(friendlyStatus(ProposalStatus.Approved, template)).toBe(
        "Ready to execute",
      );
    }
    expect(friendlyIntentLabel("")).toBe("Request");
  });
});
