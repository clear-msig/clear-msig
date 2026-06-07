import { describe, expect, it } from "vitest";
import {
  buildAgentTradeDecisionJournal,
  type AgentPolicyEvaluation,
  type AgentProfile,
  type AgentTradeProposal,
} from "@/lib/agents";

const now = 1_800_000_000_000;
const agent: AgentProfile = {
  id: "agent-alpha",
  walletName: "vault",
  name: "Agent Alpha",
  kind: "mock",
  status: "active",
  strategy: {
    mode: "paper",
    allowedMarkets: ["BTC-PERP"],
    entryRules: "Enter only after reclaiming support.",
    exitRules: "Exit when support fails.",
    riskRules: "Use one small position.",
    executionProtocol: "Send one idea at a time.",
    killSwitchRules: "Stop on vault pause.",
    updatedAt: now,
  },
  createdAt: now,
  updatedAt: now,
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
  stopLossPrice: "67000",
  takeProfitPrice: "70000",
  thesis: "BTC reclaimed support with improving momentum.",
  confidence: 72,
  expiresAt: now + 60_000,
  status: "approved",
  createdAt: now,
  updatedAt: now,
  version: 1,
};
const evaluation: AgentPolicyEvaluation = {
  decision: "allowed",
  violations: [],
  normalized: {
    market: "BTC-PERP",
    notionalUsd: 250,
    leverage: 1,
    venue: "mock_perps",
  },
};

describe("agent trade decision journal", () => {
  it("turns a trade idea into explainable evidence", () => {
    const journal = buildAgentTradeDecisionJournal({
      agent,
      proposal,
      evaluation,
      technicalSummary: "Higher low formed above support.",
      newsSummary: "Macro calendar is quiet for the next hour.",
      now,
    });

    expect(journal.summary).toContain("BTC reclaimed support");
    expect(journal.policySummary).toContain("checks passed");
    expect(journal.evidence.map((item) => item.kind)).toContain("technical");
    expect(journal.evidence.map((item) => item.kind)).toContain("strategy");
  });
});
