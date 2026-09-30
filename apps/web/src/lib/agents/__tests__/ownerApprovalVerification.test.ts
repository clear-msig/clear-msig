import { describe, expect, it } from "vitest";
import { verifyAgentOwnerApprovalSignature } from "@/features/agents/server/ownerApprovalVerification";
import { signedOwnerApproval } from "@/test/agents/signedOwnerApproval";
import type { AgentOwnerApproval } from "@/lib/agents/types";

const input = {
  walletName: "approval-binding-test",
  agentId: "agent-1",
  action: "start_automatic_trading" as const,
  targetType: "agent" as const,
  targetId: "agent-1",
};

describe("owner approval v2 signature authorization", () => {
  it("verifies the exact signed approval", () => {
    expect(verifyAgentOwnerApprovalSignature(signedOwnerApproval(input))).toBe(true);
  });

  it("rejects changing the machine action while retaining its displayed summary", () => {
    const approval = signedOwnerApproval(input);
    expect(verifyAgentOwnerApprovalSignature({ ...approval, action: "close_all_practice_trades" })).toBe(false);
  });

  it("rejects legacy or unknown signature versions rather than reinterpreting them", () => {
    const approval = signedOwnerApproval(input);
    expect(verifyAgentOwnerApprovalSignature({ ...approval, signatureVersion: undefined } as AgentOwnerApproval)).toBe(false);
    expect(verifyAgentOwnerApprovalSignature({ ...approval, signatureVersion: 3 } as unknown as AgentOwnerApproval)).toBe(false);
  });

  it("binds every detail including details beyond the display preview", () => {
    const approval = signedOwnerApproval({
      ...input,
      details: Array.from({ length: 10 }, (_, index) => ({ label: `Field ${index}`, value: `Value ${index}` })),
    });
    const details = approval.details.map((detail, index) => index === 9 ? { ...detail, value: "changed" } : detail);
    expect(verifyAgentOwnerApprovalSignature({ ...approval, details })).toBe(false);
  });

  it("rejects malformed signing fields without throwing", () => {
    const approval = signedOwnerApproval(input);
    for (const invalid of [{ createdAt: NaN }, { details: [null] }, { summary: 4 }, { signature: 4 }]) {
      expect(verifyAgentOwnerApprovalSignature({ ...approval, ...invalid } as unknown as AgentOwnerApproval)).toBe(false);
    }
  });
});
