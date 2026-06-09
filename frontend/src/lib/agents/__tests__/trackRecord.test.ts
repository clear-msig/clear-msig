import { describe, expect, it } from "vitest";
import {
  buildAgentTrackRecordBook,
  executionTrackRecordSource,
  proposalTrackRecordSource,
} from "@/lib/agents/trackRecord";
import type {
  AgentExecutionRecord,
  AgentProfile,
  AgentTradeProposal,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent track record separation", () => {
  it("keeps paper and testnet records in separate leaderboard lanes", () => {
    const book = buildAgentTrackRecordBook({
      agents: [agent("paper-agent"), agent("testnet-agent")],
      proposals: [
        proposal({ id: "paper-proposal", agentId: "paper-agent", venue: "mock_perps" }),
        proposal({
          id: "testnet-proposal",
          agentId: "testnet-agent",
          venue: "hyperliquid_testnet",
        }),
      ],
      executions: [
        execution({
          id: "paper-execution",
          agentId: "paper-agent",
          venue: "mock_perps",
          executionMode: "paper",
          realizedPnlUsd: "120",
        }),
        execution({
          id: "testnet-execution",
          agentId: "testnet-agent",
          venue: "hyperliquid_testnet",
          executionMode: "testnet",
          realizedPnlUsd: "-10",
        }),
      ],
      now,
    });

    const paper = book.lanes.find((lane) => lane.source === "paper");
    const testnet = book.lanes.find((lane) => lane.source === "testnet");
    const live = book.lanes.find((lane) => lane.source === "verified_live");

    expect(book.separated).toBe(true);
    expect(book.primarySource).toBe("testnet");
    expect(paper?.leaderboard.map((entry) => entry.agentId)).toEqual(["paper-agent"]);
    expect(testnet?.leaderboard.map((entry) => entry.agentId)).toEqual(["testnet-agent"]);
    expect(live?.leaderboard).toEqual([]);
    expect(paper?.realizedPnlUsd).toBe("120");
    expect(testnet?.realizedPnlUsd).toBe("-10");
  });

  it("classifies current and future execution records by source", () => {
    expect(
      executionTrackRecordSource(
        execution({
          id: "paper",
          agentId: "agent",
          venue: "mock_perps",
          executionMode: "paper",
        }),
      ),
    ).toBe("paper");
    expect(
      executionTrackRecordSource(
        execution({
          id: "testnet",
          agentId: "agent",
          venue: "hyperliquid_testnet",
          executionMode: "testnet",
        }),
      ),
    ).toBe("testnet");
    expect(
      executionTrackRecordSource({
        ...execution({
          id: "live",
          agentId: "agent",
          venue: "hyperliquid_testnet",
          executionMode: "testnet",
        }),
        executionMode: "live" as AgentExecutionRecord["executionMode"],
        externalOrderId: "venue-order-1",
      }),
    ).toBe("verified_live");
  });

  it("classifies proposals without mixing paper and venue ideas", () => {
    expect(proposalTrackRecordSource(proposal({ venue: "mock_perps" }))).toBe("paper");
    expect(proposalTrackRecordSource(proposal({ venue: "hyperliquid_testnet" }))).toBe(
      "testnet",
    );
  });
});

function agent(id: string): AgentProfile {
  return {
    id,
    walletName: "vault",
    name: id,
    kind: "mock",
    status: "active",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function proposal({
  id = "proposal",
  agentId = "agent",
  venue = "mock_perps",
}: Partial<AgentTradeProposal> = {}): AgentTradeProposal {
  return {
    id,
    walletName: "vault",
    agentId,
    venue,
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    confidence: 70,
    expiresAt: now + 60_000,
    status: "executed",
    createdAt: now,
    updatedAt: now,
    version: 1,
  } as AgentTradeProposal;
}

function execution({
  id,
  agentId,
  venue,
  executionMode,
  realizedPnlUsd = "0",
}: {
  id: string;
  agentId: string;
  venue: AgentExecutionRecord["venue"];
  executionMode: AgentExecutionRecord["executionMode"];
  realizedPnlUsd?: string;
}): AgentExecutionRecord {
  return {
    id,
    walletName: "vault",
    proposalId: `${id}-proposal`,
    agentId,
    venue,
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    executionMode,
    status: "closed",
    openedAt: now,
    closedAt: now + 60_000,
    realizedPnlUsd,
    version: 1,
  };
}
