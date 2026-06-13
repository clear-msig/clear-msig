import { describe, expect, it } from "vitest";
import type { HyperliquidTestnetAccountSnapshot } from "@/lib/agents/serverHyperliquidTestnet";
import type { AgentTradeProposal } from "@/lib/agents/types";
import {
  buildAgentTradeLifecycle,
  summarizeAgentTradeLifecycles,
} from "@/lib/agents/tradeLifecycle";

const baseProposal: AgentTradeProposal = {
  id: "proposal-1",
  walletName: "Agent vault",
  agentId: "agent-1",
  venue: "hyperliquid_testnet",
  market: "ETH",
  side: "long",
  orderType: "market",
  notionalUsd: "500",
  leverage: 2,
  confidence: 72,
  expiresAt: 1_700_000_000_000,
  status: "needs_approval",
  createdAt: 1_699_999_990_000,
  updatedAt: 1_699_999_990_000,
  version: 1,
};

const fundedSnapshot: HyperliquidTestnetAccountSnapshot = {
  state: "funded",
  accountAddress: "0x123",
  accountValueUsd: "1000",
  withdrawableUsd: "800",
  totalPositionValueUsd: "500",
  unrealizedPnlUsd: "12",
  positions: [
    {
      market: "ETH",
      side: "long",
      size: "0.1",
      entryPriceUsd: "3000",
      positionValueUsd: "500",
      unrealizedPnlUsd: "12",
      returnOnEquityPct: "2.4",
      liquidationPriceUsd: null,
    },
  ],
  observedAt: 1_700_000_000_000,
  message: "Funded",
};

describe("buildAgentTradeLifecycle", () => {
  it("marks policy-blocked proposals as blocked", () => {
    const lifecycle = buildAgentTradeLifecycle({
      proposal: {
        ...baseProposal,
        status: "blocked",
        policyViolations: [
          {
            code: "notional_too_large",
            severity: "block",
            message: "Notional is above allowance.",
          },
        ],
      },
    });

    expect(lifecycle.status).toBe("blocked");
    expect(lifecycle.tone).toBe("danger");
    expect(lifecycle.steps.find((step) => step.id === "policy")?.status).toBe("blocked");
  });

  it("shows approved Hyperliquid proposals as ready for venue submission", () => {
    const lifecycle = buildAgentTradeLifecycle({
      proposal: { ...baseProposal, status: "approved" },
    });

    expect(lifecycle.status).toBe("approved");
    expect(lifecycle.label).toBe("Approved");
    expect(lifecycle.steps.find((step) => step.id === "execution")?.detail).toBe(
      "Ready for venue",
    );
    expect(lifecycle.steps.find((step) => step.id === "venue_reconciliation")?.status).toBe(
      "current",
    );
  });

  it("marks submitted venue requests with matching positions as open", () => {
    const lifecycle = buildAgentTradeLifecycle({
      proposal: { ...baseProposal, status: "executed" },
      venueRequest: {
        status: "submitted",
        artifact: { orderId: "order-1", status: "filled" },
        request: {
          venue: "hyperliquid_testnet",
          market: "ETH",
          side: "long",
        },
      },
      accountSnapshot: fundedSnapshot,
    });

    expect(lifecycle.status).toBe("open");
    expect(lifecycle.label).toBe("Open");
    expect(lifecycle.steps.find((step) => step.id === "venue_reconciliation")?.detail).toBe(
      "Open on Hyperliquid",
    );
  });

  it("warns when a submitted venue request is not open on the exchange", () => {
    const lifecycle = buildAgentTradeLifecycle({
      proposal: { ...baseProposal, status: "executed" },
      venueRequest: {
        status: "submitted",
        artifact: { orderId: "order-2", status: "accepted" },
        request: {
          venue: "hyperliquid_testnet",
          market: "BTC",
          side: "short",
        },
      },
      accountSnapshot: fundedSnapshot,
    });

    expect(lifecycle.status).toBe("warning");
    expect(lifecycle.tone).toBe("warning");
    expect(lifecycle.steps.find((step) => step.id === "venue_reconciliation")?.status).toBe(
      "warning",
    );
  });

  it("summarizes lifecycle queues by priority", () => {
    const approval = buildAgentTradeLifecycle({
      proposal: { ...baseProposal, id: "approval", status: "needs_approval" },
    });
    const warning = buildAgentTradeLifecycle({
      proposal: { ...baseProposal, id: "warning", status: "executed" },
      venueRequest: {
        status: "submitted",
        request: {
          venue: "hyperliquid_testnet",
          market: "BTC",
          side: "short",
        },
      },
      accountSnapshot: fundedSnapshot,
    });
    const blocked = buildAgentTradeLifecycle({
      proposal: {
        ...baseProposal,
        id: "blocked",
        status: "blocked",
        policyViolations: [
          {
            code: "daily_loss_cap_reached",
            severity: "block",
            message: "Daily loss cap reached.",
          },
        ],
      },
    });

    const summary = summarizeAgentTradeLifecycles([approval, warning, blocked]);

    expect(summary.total).toBe(3);
    expect(summary.needsApproval).toBe(1);
    expect(summary.warnings).toBe(1);
    expect(summary.blocked).toBe(1);
    expect(summary.actionable).toBe(3);
    expect(summary.label).toBe("Blocked");
    expect(summary.tone).toBe("danger");
  });

  it("summarizes active trading when open or submitted trades exist", () => {
    const open = buildAgentTradeLifecycle({
      proposal: { ...baseProposal, status: "executed" },
      venueRequest: {
        status: "submitted",
        request: {
          venue: "hyperliquid_testnet",
          market: "ETH",
          side: "long",
        },
      },
      accountSnapshot: fundedSnapshot,
    });

    const summary = summarizeAgentTradeLifecycles([open]);

    expect(summary.open).toBe(1);
    expect(summary.label).toBe("Trading");
    expect(summary.tone).toBe("success");
  });
});
