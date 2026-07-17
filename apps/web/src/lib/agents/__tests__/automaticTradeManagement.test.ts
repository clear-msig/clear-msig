import { describe, expect, it } from "vitest";
import {
  buildAgentAutomaticExitDecisions,
  type AgentExecutionRecord,
  type AgentTradeProposal,
} from "@/lib/agents";

function execution(
  overrides: Partial<AgentExecutionRecord> = {},
): AgentExecutionRecord {
  return {
    id: "execution-1",
    walletName: "vault",
    proposalId: "proposal-1",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    entryPrice: "100",
    status: "open",
    openedAt: 1_800_000_000_000,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
    ...overrides,
  };
}

function proposal(overrides: Partial<AgentTradeProposal> = {}): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName: "vault",
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    entryPrice: "100",
    stopLossPrice: "95",
    takeProfitPrice: "110",
    confidence: 70,
    expiresAt: 1_800_000_100_000,
    status: "executed",
    createdAt: 1_800_000_000_000,
    updatedAt: 1_800_000_000_000,
    version: 1,
    ...overrides,
  };
}

describe("agent automatic trade management", () => {
  it("detects a long take-profit exit", () => {
    const decisions = buildAgentAutomaticExitDecisions({
      executions: [execution()],
      proposals: [proposal()],
      marketByMarket: {
        "BTC-PERP": {
          provider: "mock",
          source: "mock",
          market: "BTC-PERP",
          observedAt: 1_800_000_010_000,
          markPriceUsd: "111",
          fundingRatePct: null,
          openInterestUsd: null,
          volume24hUsd: null,
        },
      },
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe("take_profit");
    expect(decisions[0]?.realizedPnlUsd).toBe("11");
  });

  it("detects a short stop-loss exit", () => {
    const decisions = buildAgentAutomaticExitDecisions({
      executions: [execution({ side: "short" })],
      proposals: [
        proposal({
          side: "short",
          stopLossPrice: "105",
          takeProfitPrice: "90",
        }),
      ],
      marketByMarket: {
        "BTC-PERP": {
          provider: "mock",
          source: "mock",
          market: "BTC-PERP",
          observedAt: 1_800_000_010_000,
          markPriceUsd: "106",
          fundingRatePct: null,
          openInterestUsd: null,
          volume24hUsd: null,
        },
      },
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0]?.reason).toBe("stop_loss");
    expect(decisions[0]?.realizedPnlUsd).toBe("-6");
  });
});
