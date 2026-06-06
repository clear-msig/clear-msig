import { describe, expect, it } from "vitest";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";

describe("agent owner approval messages", () => {
  it("builds a readable wallet signing message", () => {
    const text = ownerApprovalSignableText(
      {
        walletName: "demo",
        agentId: "agent-alpha",
        action: "grant_allowance",
        summary: "Give practice allowance",
        targetType: "session",
        targetId: "session-1",
        details: [
          { label: "Trader", value: "Agent Alpha" },
          { label: "Size", value: "$250" },
        ],
      },
      Date.UTC(2026, 5, 1, 12, 0, 0),
    );

    expect(text).toContain("ClearSig Agent Trading Approval");
    expect(text).toContain("Action: Give practice allowance");
    expect(text).toContain("Wallet: demo");
    expect(text).toContain("Trader ID: agent-alpha");
    expect(text).toContain("Target: session/session-1");
    expect(text).toContain("Trader: Agent Alpha");
    expect(text).toContain("Size: $250");
  });
});
