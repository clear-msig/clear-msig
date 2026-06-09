import { describe, expect, it } from "vitest";
import {
  buildAgentMarketplaceRegistry,
  parseAgentMarketplaceWallets,
} from "@/lib/agents/marketplaceRegistry";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import type { AgentServerWalletState } from "@/lib/agents/serverState";
import type {
  AgentExecutionRecord,
  AgentProfile,
  AgentTrackRecordSource,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

describe("agent marketplace registry", () => {
  it("lists only approved public profiles and keeps track-record lanes separated", () => {
    const registry = buildAgentMarketplaceRegistry({
      states: [
        state({
          walletName: "vault-a",
          agents: [
            agent({ id: "paper-agent", walletName: "vault-a", slug: "paper-alpha" }),
            agent({
              id: "pending-agent",
              walletName: "vault-a",
              slug: "pending-alpha",
              moderationStatus: "pending_review",
            }),
          ],
          executions: [
            execution({
              id: "paper-win",
              walletName: "vault-a",
              agentId: "paper-agent",
              source: "paper",
              realizedPnlUsd: "60",
            }),
          ],
        }),
        state({
          walletName: "vault-b",
          agents: [agent({ id: "testnet-agent", walletName: "vault-b", slug: "testnet-alpha" })],
          executions: [
            execution({
              id: "testnet-win",
              walletName: "vault-b",
              agentId: "testnet-agent",
              source: "testnet",
              realizedPnlUsd: "10",
            }),
          ],
        }),
      ],
      now,
    });

    expect(registry.entries.map((entry) => entry.slug)).toEqual([
      "testnet-alpha",
      "paper-alpha",
    ]);
    expect(registry.entries).toHaveLength(2);
    expect(registry.entries[0]).toMatchObject({
      walletName: "vault-b",
      primarySource: "testnet",
      url: "/agents/vault-b/testnet-alpha",
    });
    expect(registry.entries[1]?.laneSummaries.map((lane) => lane.source)).toEqual([
      "paper",
      "testnet",
      "verified_live",
    ]);
    expect(registry.filters.markets).toEqual(["BTC-PERP", "ETH-PERP"]);
    expect(registry.filters.sources).toEqual(["paper", "testnet"]);
  });

  it("parses configured wallet allowlists without duplicates", () => {
    expect(parseAgentMarketplaceWallets(" vault-a, vault-b\nvault-a ,, ")).toEqual([
      "vault-a",
      "vault-b",
    ]);
  });
});

function state({
  walletName,
  agents,
  executions,
}: {
  walletName: string;
  agents: AgentProfile[];
  executions: AgentExecutionRecord[];
}): AgentServerWalletState {
  return {
    walletName,
    agents,
    policy: defaultAgentVaultPolicy(walletName, now),
    proposals: [],
    sessions: [],
    executions,
    events: [],
    approvals: [],
    scorecards: {},
    updatedAt: now,
    version: 1,
  };
}

function agent({
  id,
  walletName,
  slug,
  moderationStatus = "approved",
}: {
  id: string;
  walletName: string;
  slug: string;
  moderationStatus?: "approved" | "pending_review";
}): AgentProfile {
  return {
    id,
    walletName,
    name: slug,
    kind: "api",
    status: "active",
    identityPubkey: `${id}-pubkey`,
    strategy: {
      mode: "paper",
      summary: "Disciplined public strategy.",
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      entryRules: "Enter confirmed momentum.",
      exitRules: "Exit when thesis fails.",
      riskRules: "Use strict stops.",
      executionProtocol: "Submit decisions to ClearSig.",
      killSwitchRules: "Pause after abnormal losses.",
      updatedAt: now,
    },
    publishing: {
      status: "published",
      slug,
      publicSummary: `${slug} public summary.`,
      visibleMetrics: [
        "score",
        "realized_pnl",
        "closed_trades",
        "open_trades",
        "win_rate",
        "safety_stops",
      ],
      moderation: {
        status: moderationStatus,
        reason: "Reviewed.",
        reviewedAt: moderationStatus === "approved" ? now : undefined,
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
  };
}

function execution({
  id,
  walletName,
  agentId,
  source,
  realizedPnlUsd,
}: {
  id: string;
  walletName: string;
  agentId: string;
  source: AgentTrackRecordSource;
  realizedPnlUsd: string;
}): AgentExecutionRecord {
  return {
    id,
    walletName,
    proposalId: `${id}-proposal`,
    agentId,
    venue: source === "paper" ? "mock_perps" : "hyperliquid_testnet",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "100",
    leverage: 1,
    executionMode: source === "paper" ? "paper" : "testnet",
    status: "closed",
    openedAt: now,
    closedAt: now + 60_000,
    realizedPnlUsd,
    version: 1,
  };
}

