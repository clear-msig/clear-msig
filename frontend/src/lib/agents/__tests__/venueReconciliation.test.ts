import { describe, expect, it } from "vitest";
import { buildAgentVenueReconciliationSummary } from "@/lib/agents/venueReconciliation";
import type { AgentServerExecutionRecord } from "@/lib/agents/serverExecutionRequests";
import type { HyperliquidTestnetAccountSnapshot } from "@/lib/agents/serverHyperliquidTestnet";

const now = Date.UTC(2026, 5, 9, 12, 0, 0);

const submittedRequest: AgentServerExecutionRecord = {
  id: "request-1",
  status: "submitted",
  readinessState: "ready",
  message: "Hyperliquid testnet order 123 was filled.",
  artifact: {
    exchange: "hyperliquid_testnet",
    orderId: "123",
    status: "filled",
    market: "BTC-PERP",
    side: "long",
    submittedAt: now,
  },
  createdAt: now,
  updatedAt: now,
  version: 1,
  request: {
    walletName: "vault",
    agentId: "agent-alpha",
    proposalId: "proposal-1",
    venue: "hyperliquid_testnet",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    approvedAt: now,
  },
};

const accountSnapshot: HyperliquidTestnetAccountSnapshot = {
  state: "funded",
  accountAddress: "0x1111111111111111111111111111111111111111",
  accountValueUsd: "1000",
  withdrawableUsd: "800",
  totalPositionValueUsd: "250",
  unrealizedPnlUsd: "12.5",
  observedAt: now,
  message: "Hyperliquid testnet account is reachable and funded.",
  positions: [
    {
      market: "BTC-PERP",
      side: "long",
      size: "0.01",
      entryPriceUsd: "60000",
      positionValueUsd: "606.58",
      unrealizedPnlUsd: "12.5",
      returnOnEquityPct: "2.1",
      liquidationPriceUsd: "45000",
    },
  ],
};

describe("venue reconciliation", () => {
  it("marks submitted requests as reconciled when the venue has a matching position", () => {
    const summary = buildAgentVenueReconciliationSummary({
      venue: "hyperliquid_testnet",
      requests: [submittedRequest],
      accountSnapshot,
      now,
    });

    expect(summary.status).toBe("healthy");
    expect(summary.submittedRequests).toBe(1);
    expect(summary.openRequests).toBe(1);
    expect(summary.exchangeOpenPositions).toBe(1);
    expect(summary.issues).toHaveLength(0);
  });

  it("flags unmatched exchange positions and missing order ids", () => {
    const summary = buildAgentVenueReconciliationSummary({
      venue: "hyperliquid_testnet",
      requests: [
        {
          ...submittedRequest,
          artifact: undefined,
          request: { ...submittedRequest.request, market: "ETH-PERP" },
        },
      ],
      accountSnapshot,
      now,
    });

    expect(summary.status).toBe("warning");
    expect(summary.missingOrderIds).toBe(1);
    expect(summary.unmatchedPositions).toBe(1);
    expect(summary.issues.map((issue) => issue.id)).toEqual(
      expect.arrayContaining(["missing_order_ids", "unmatched_exchange_positions"]),
    );
  });

  it("blocks leaderboard trust when the venue state is unavailable", () => {
    const summary = buildAgentVenueReconciliationSummary({
      venue: "hyperliquid_testnet",
      requests: [submittedRequest],
      accountSnapshot: {
        ...accountSnapshot,
        state: "unavailable",
        positions: [],
        message: "Could not reach Hyperliquid testnet account state.",
      },
      now,
    });

    expect(summary.status).toBe("blocked");
    expect(summary.issues.map((issue) => issue.id)).toContain(
      "account_snapshot_unavailable",
    );
  });
});
