import { describe, expect, it } from "vitest";
import {
  buildAgentPostTradeReview,
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
  status: "closed",
  openedAt: 1_800_000_000_000,
  closedAt: 1_800_000_060_000,
  realizedPnlUsd: "42",
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
  confidence: 72,
  expiresAt: 1_800_000_100_000,
  status: "executed",
  createdAt: 1_800_000_000_000,
  updatedAt: 1_800_000_000_000,
  version: 1,
  decisionJournal: {
    summary: "BTC reclaimed support.",
    entryReason: "Momentum improved.",
    riskPlan: "Small position with close stop.",
    exitPlan: "Exit on failed support.",
    invalidation: "Support fails.",
    policySummary: "ClearSig checks passed.",
    confidenceRationale: "72% confidence.",
    evidence: [],
    createdAt: 1_800_000_000_000,
    version: 1,
  },
};

describe("agent post-trade review", () => {
  it("reviews a profitable trade against its thesis", () => {
    const review = buildAgentPostTradeReview({
      execution,
      proposal,
      realizedPnlUsd: "42",
      now: 1_800_000_070_000,
    });

    expect(review.outcome).toBe("win");
    expect(review.thesisVerdict).toBe("confirmed");
    expect(review.summary).toContain("BTC reclaimed support");
    expect(review.riskReview).toContain("Planned risk");
  });

  it("marks losing trades as invalidated", () => {
    const review = buildAgentPostTradeReview({
      execution,
      proposal,
      realizedPnlUsd: "-20",
    });

    expect(review.outcome).toBe("loss");
    expect(review.thesisVerdict).toBe("invalidated");
    expect(review.lesson).toContain("Support fails");
  });
});
