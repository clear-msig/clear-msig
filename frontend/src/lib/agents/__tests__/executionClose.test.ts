import { describe, expect, it } from "vitest";
import {
  closeAgentExecutionRecord,
  type AgentExecutionRecord,
  type AgentTradeProposal,
} from "@/lib/agents";

const execution: AgentExecutionRecord = {
  id: "execution-1",
  walletName: "vault",
  proposalId: "proposal-1",
  agentId: "agent-alpha",
  venue: "mock_perps",
  market: "BTC-PERP",
  side: "long",
  orderType: "market",
  notionalUsd: "250",
  leverage: 1,
  entryPrice: "70000",
  status: "open",
  openedAt: 1_800_000_000_000,
  closedAt: null,
  realizedPnlUsd: "0",
  version: 1,
};

const proposal: AgentTradeProposal = {
  id: "proposal-1",
  walletName: "vault",
  agentId: "agent-alpha",
  venue: "mock_perps",
  market: "BTC-PERP",
  side: "long",
  orderType: "market",
  notionalUsd: "250",
  leverage: 1,
  entryPrice: "70000",
  stopLossPrice: "68000",
  takeProfitPrice: "73500",
  thesis: "Momentum breakout.",
  confidence: 72,
  expiresAt: 1_800_000_100_000,
  status: "executed",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  version: 1,
};

describe("agent execution close builder", () => {
  it("closes an execution and attaches a post-trade review", () => {
    const closed = closeAgentExecutionRecord({
      execution,
      proposal,
      realizedPnlUsd: "42.567",
      now: 1_800_000_050_000,
    });

    expect(closed.status).toBe("closed");
    expect(closed.realizedPnlUsd).toBe("42.57");
    expect(closed.closedAt).toBe(1_800_000_050_000);
    expect(closed.postTradeReview?.outcome).toBe("win");
    expect(closed.postTradeReview?.summary).toContain("Momentum breakout");
  });
});
