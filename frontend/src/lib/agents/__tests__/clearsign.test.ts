import { describe, expect, it } from "vitest";
import { buildAgentTradeClearSignV2 } from "@/lib/agents/clearsign";
import type { AgentTradeProposal } from "@/lib/agents/types";

const baseProposal: AgentTradeProposal = {
  id: "proposal-1",
  walletName: "Team treasury",
  agentId: "agent-1",
  venue: "hyperliquid_testnet",
  market: "btc-perp",
  side: "long",
  orderType: "limit",
  notionalUsd: "250.00",
  leverage: 2.5,
  stopLossPrice: "62000",
  takeProfitPrice: "71000",
  confidence: 78,
  clientSignalId: "signal-1",
  expiresAt: 1_783_424_650_000,
  evaluationDecision: "requires_human_approval",
  policyHash:
    "4efe872d78c9ae2539f70ecc1d88dd3f764862cef132a3700e0db695d631382c",
  policyViolations: [],
  status: "needs_approval",
  createdAt: 1_783_423_750_000,
  updatedAt: 1_783_423_750_000,
  version: 1,
};

describe("agent ClearSign v2 binding", () => {
  it("builds executor fields for typed agent approval", () => {
    const binding = buildAgentTradeClearSignV2(baseProposal);

    expect(binding.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(binding.envelopeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(binding.signableText).toContain("Approve BTC-PERP long up to $250");
    expect(binding.payload).toMatchObject({
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      maxNotionalUsd: "250",
      maxLeverage: "2.5x",
      assetId: "USDC:hyperliquid_testnet",
      sessionId: "signal-1",
      route: "hyperliquid_testnet:limit",
    });
    expect(binding.executor.amountRaw).toBe("250000000");
    expect(binding.executor.maxLeverageX100).toBe(250);
    expect(binding.executor.riskCheckHash).toBe(binding.payload.riskCheckHash);
    expect(binding.executor.venueHash).toMatch(/^[0-9a-f]{64}$/);
    expect(binding.executor.routeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the payload hash when risk fields change", () => {
    const first = buildAgentTradeClearSignV2(baseProposal);
    const second = buildAgentTradeClearSignV2({
      ...baseProposal,
      stopLossPrice: "61000",
    });

    expect(first.payloadHash).not.toBe(second.payloadHash);
    expect(first.executor.riskCheckHash).not.toBe(
      second.executor.riskCheckHash,
    );
  });
});
