import { describe, expect, it } from "vitest";
import {
  createBrowserOwnerApproval,
  ownerApprovalSignableText,
} from "@/lib/agents/ownerApproval";

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

  it("separates browser approvals from signed wallet approvals in the hash", async () => {
    const base = {
      walletName: "demo",
      agentId: "agent-alpha",
      action: "start_automatic_trading" as const,
      summary: "Turn on automatic trading",
      targetType: "agent" as const,
      targetId: "agent-alpha",
      now: Date.UTC(2026, 5, 1, 12, 0, 0),
      details: [{ label: "Trader", value: "Agent Alpha" }],
    };

    const browser = await createBrowserOwnerApproval(base);
    const signed = await createBrowserOwnerApproval({
      ...base,
      approvedBy: "signer-pubkey",
      signature: "deadbeef",
    });

    expect(browser.approvalMethod).toBe("browser_confirm");
    expect(signed.approvalMethod).toBe("wallet_signature");
    expect(browser.approvalHash).not.toBe(signed.approvalHash);
  });
});
