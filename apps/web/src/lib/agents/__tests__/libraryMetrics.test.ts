import { describe, expect, it } from "vitest";
import {
  agentLibraryMetrics,
  type AgentExecutionRecord,
  type AgentProfile,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 6, 12, 0, 0);

const agent: AgentProfile = {
  id: "agent-alpha",
  walletName: "vault",
  name: "Agent Alpha",
  kind: "mock",
  status: "active",
  createdAt: now - 10 * 24 * 60 * 60 * 1000,
  updatedAt: now,
  version: 1,
};

function execution(
  id: string,
  overrides: Partial<AgentExecutionRecord>,
): AgentExecutionRecord {
  return {
    id,
    walletName: "vault",
    proposalId: `proposal-${id}`,
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    status: "closed",
    openedAt: now - 2 * 24 * 60 * 60 * 1000,
    closedAt: now - 24 * 60 * 60 * 1000,
    realizedPnlUsd: "10",
    version: 1,
    ...overrides,
  };
}

describe("agent library metrics", () => {
  it("summarizes age, recent pnl, win rate, and open trades", () => {
    const metrics = agentLibraryMetrics({
      agent,
      now,
      executions: [
        execution("win", { realizedPnlUsd: "25" }),
        execution("loss", { realizedPnlUsd: "-5" }),
        execution("old", {
          realizedPnlUsd: "100",
          openedAt: now - 14 * 24 * 60 * 60 * 1000,
          closedAt: now - 13 * 24 * 60 * 60 * 1000,
        }),
        execution("open", { status: "open", closedAt: null, realizedPnlUsd: "0" }),
      ],
    });

    expect(metrics.ageDays).toBe(10);
    expect(metrics.closedTrades).toBe(3);
    expect(metrics.openTrades).toBe(1);
    expect(metrics.winRatePct).toBe(67);
    expect(metrics.sevenDayPnlUsd).toBe("20");
    expect(metrics.thirtyDayPnlUsd).toBe("120");
    expect(metrics.hasHistory).toBe(true);
  });

  it("keeps empty agents clearly marked as new", () => {
    const metrics = agentLibraryMetrics({
      agent,
      now,
      executions: [],
    });

    expect(metrics.winRatePct).toBeNull();
    expect(metrics.hasHistory).toBe(false);
    expect(metrics.sevenDayPnlUsd).toBe("0");
    expect(metrics.thirtyDayPnlUsd).toBe("0");
  });
});
