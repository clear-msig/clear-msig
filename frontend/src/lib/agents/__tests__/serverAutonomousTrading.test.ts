import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { runAgentAutonomyTick } from "@/lib/agents/serverAutonomousTrading";
import {
  getAgentServerWalletState,
  saveAgentServerProfile,
  saveAgentServerSession,
  saveAgentServerVaultPolicy,
} from "@/lib/agents/serverState";
import type {
  AgentProfile,
  AgentSessionGrant,
  AgentVaultPolicy,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);
const walletName = "autonomy-hyperliquid";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agent autonomous trading tick", () => {
  it("turns live Hyperliquid market data into a guarded executable proposal", async () => {
    await saveAgentServerProfile(agent());
    await saveAgentServerVaultPolicy(policy());
    await saveAgentServerSession(session());

    const result = await runAgentAutonomyTick({
      walletName,
      venue: "hyperliquid_testnet",
      maxMarkets: 5,
      maxIdeas: 1,
      now,
      fetchImpl: hyperliquidFetch,
    });
    const state = await getAgentServerWalletState(walletName);

    expect(result.scannedMarkets).toBe(2);
    expect(result.consideredMarkets).toBe(2);
    expect(result.reports).toHaveLength(1);
    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0]?.proposal).toMatchObject({
      agentId: "agent-alpha",
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      status: "approved",
      evaluationDecision: "allowed",
    });
    expect(result.proposals[0]?.execution?.placed).toBe(false);
    expect(state.proposals[0]?.status).toBe("approved");
  });

  it("does not scan when no active agent has a venue session", async () => {
    const routeWalletName = "autonomy-no-session";
    await saveAgentServerProfile(agent(routeWalletName));
    await saveAgentServerVaultPolicy(policy(routeWalletName));

    const result = await runAgentAutonomyTick({
      walletName: routeWalletName,
      venue: "hyperliquid_testnet",
      now,
      fetchImpl: hyperliquidFetch,
    });

    expect(result.scannedMarkets).toBe(0);
    expect(result.proposals).toEqual([]);
    expect(result.message).toContain("owner-approved session");
  });
});

function agent(name = walletName): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: name,
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "bounded_live",
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
      summary: "Momentum trader for liquid perps.",
      entryRules: "Use liquid momentum setups only.",
      exitRules: "Exit on invalidation.",
      riskRules: "Respect ClearSig policy limits.",
      executionProtocol: "Hyperliquid testnet only.",
      killSwitchRules: "Stop when risk fails.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function policy(name = walletName): AgentVaultPolicy {
  return {
    ...defaultAgentVaultPolicy(name, now),
    allowedVenues: ["hyperliquid_testnet"],
    allowedMarkets: ["BTC-PERP", "ETH-PERP"],
    maxNotionalUsd: "500",
    maxLeverage: 2,
    cooldownSeconds: 0,
  };
}

function session(name = walletName): AgentSessionGrant {
  return {
    id: "session-1",
    walletName: name,
    agentId: "agent-alpha",
    status: "active",
    startsAt: now,
    expiresAt: now + 60 * 60 * 1000,
    allowedVenues: ["hyperliquid_testnet"],
    allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "300",
    maxLeverage: 2,
    maxOpenPositions: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

async function hyperliquidFetch(): Promise<Response> {
  return new Response(
    JSON.stringify([
      {
        universe: [
          { name: "BTC", szDecimals: 5, maxLeverage: 40 },
          { name: "ETH", szDecimals: 4, maxLeverage: 25 },
        ],
      },
      [
        {
          markPx: "67500",
          funding: "0.0001",
          openInterest: "100",
          dayNtlVlm: "32000000",
        },
        {
          markPx: "3850",
          funding: "0.00008",
          openInterest: "200",
          dayNtlVlm: "14000000",
        },
      ],
    ]),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
