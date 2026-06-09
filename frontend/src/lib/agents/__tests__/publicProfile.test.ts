import { describe, expect, it } from "vitest";
import {
  buildAgentPublicProfile,
  isPubliclyVisible,
  publicProfileUrl,
} from "@/lib/agents/publicProfile";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import type { AgentServerWalletState } from "@/lib/agents/serverState";
import type {
  AgentExecutionRecord,
  AgentProfile,
  AgentTradeProposal,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent public profiles", () => {
  it("only exposes approved published agents", () => {
    const approved = agent({
      publishing: {
        status: "published",
        slug: "approved-alpha",
        publicSummary: "Approved public profile.",
        visibleMetrics: ["score", "realized_pnl"],
        moderation: {
          status: "approved",
          reason: "Reviewed.",
          reviewedAt: now,
          updatedAt: now,
          version: 1,
        },
        publishedAt: now,
        updatedAt: now,
        version: 1,
      },
    });
    const pending = agent({
      id: "pending",
      publishing: {
        status: "published",
        slug: "pending-alpha",
        publicSummary: "Pending profile.",
        visibleMetrics: ["score"],
        moderation: {
          status: "pending_review",
          updatedAt: now,
          version: 1,
        },
        publishedAt: now,
        updatedAt: now,
        version: 1,
      },
    });

    expect(isPubliclyVisible(approved)).toBe(true);
    expect(isPubliclyVisible(pending)).toBe(false);
    expect(buildAgentPublicProfile({ state: state([approved, pending]), slug: "pending-alpha", now })).toBeNull();
    expect(buildAgentPublicProfile({ state: state([approved, pending]), slug: "approved-alpha", now })?.name).toBe("Alpha");
  });

  it("builds a public track record and decision journal snapshot", () => {
    const profile = buildAgentPublicProfile({
      state: state([agent()], [proposal()], [execution()]),
      slug: "alpha-agent",
      now,
    });

    expect(profile).toMatchObject({
      walletName: "vault",
      name: "Alpha",
      slug: "alpha-agent",
      primarySource: "paper",
    });
    const paper = profile?.lanes.find((lane) => lane.source === "paper");
    expect(paper).toMatchObject({
      label: "Paper",
      realizedPnlUsd: "40",
      closedTrades: 1,
      openTrades: 0,
      winRatePct: 100,
      ruleViolations: 0,
    });
    expect(profile?.recentTrades[0]).toMatchObject({
      market: "BTC-PERP",
      source: "paper",
      realizedPnlUsd: "40",
    });
    expect(profile?.recentDecisions[0]).toMatchObject({
      market: "BTC-PERP",
      summary: "BTC reclaimed support after volatility cooled.",
      policySummary: "Allowed by active paper allowance.",
    });
    expect(profile?.recentDecisions[0]?.evidence[0]).toMatchObject({
      label: "Technical read",
    });
  });

  it("formats wallet-scoped public URLs", () => {
    expect(publicProfileUrl("BB#5qxnc7", "alpha-agent")).toBe(
      "/agents/BB%235qxnc7/alpha-agent",
    );
  });
});

function state(
  agents: AgentProfile[],
  proposals: AgentTradeProposal[] = [],
  executions: AgentExecutionRecord[] = [],
): AgentServerWalletState {
  return {
    walletName: "vault",
    agents,
    policy: defaultAgentVaultPolicy("vault", now),
    proposals,
    sessions: [],
    executions,
    events: [],
    approvals: [],
    scorecards: {},
    updatedAt: now,
    version: 1,
  };
}

function agent(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: "alpha",
    walletName: "vault",
    name: "Alpha",
    kind: "api",
    status: "active",
    identityPubkey: "creator-pubkey",
    description: "External strategy agent.",
    strategy: {
      mode: "paper",
      summary: "Momentum strategy with strict invalidation.",
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      entryRules: "Enter after reclaiming support.",
      exitRules: "Exit at invalidation or target.",
      riskRules: "Risk small and stop fast.",
      executionProtocol: "Submit decisions to ClearSig.",
      killSwitchRules: "Pause after daily loss cap.",
      updatedAt: now,
    },
    publishing: {
      status: "published",
      slug: "alpha-agent",
      publicSummary: "Alpha scans BTC and ETH for disciplined momentum trades.",
      visibleMetrics: [
        "score",
        "realized_pnl",
        "closed_trades",
        "open_trades",
        "win_rate",
        "safety_stops",
      ],
      moderation: {
        status: "approved",
        reason: "Profile passed marketplace review.",
        reviewedBy: "ClearSig admin",
        reviewedAt: now,
        updatedAt: now,
        version: 1,
      },
      publishedAt: now,
      updatedAt: now,
      version: 1,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
    ...overrides,
  };
}

function proposal(): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName: "vault",
    agentId: "alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    confidence: 78,
    expiresAt: now + 60_000,
    status: "executed",
    decisionJournal: {
      summary: "BTC reclaimed support after volatility cooled.",
      entryReason: "Momentum returned with defined invalidation.",
      technicalSummary: "Higher low formed above support.",
      riskPlan: "Stop below reclaimed support.",
      exitPlan: "Exit at target or support loss.",
      invalidation: "Support break invalidates the idea.",
      policySummary: "Allowed by active paper allowance.",
      confidenceRationale: "78% confidence from technical and risk evidence.",
      evidence: [
        {
          id: "technical",
          kind: "technical",
          label: "Technical read",
          summary: "BTC reclaimed support on rising participation.",
          observedAt: now,
        },
      ],
      createdAt: now,
      version: 1,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function execution(): AgentExecutionRecord {
  return {
    id: "execution-1",
    walletName: "vault",
    proposalId: "proposal-1",
    agentId: "alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    executionMode: "paper",
    status: "closed",
    openedAt: now,
    closedAt: now + 60_000,
    realizedPnlUsd: "40",
    postTradeReview: {
      outcome: "win",
      thesisVerdict: "confirmed",
      summary: "Support held and target was reached.",
      lesson: "Waited for confirmation.",
      riskReview: "Risk stayed inside policy.",
      realizedPnlUsd: "40",
      reviewedAt: now + 60_000,
      version: 1,
    },
    version: 1,
  };
}

