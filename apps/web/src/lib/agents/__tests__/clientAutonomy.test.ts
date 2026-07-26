import { afterEach, describe, expect, it, vi } from "vitest";
import { runAgentAutonomyTickClient } from "@/lib/agents/clientAutonomy";
import type { AgentTradeProposal } from "@/lib/agents/types";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent autonomy client adapter", () => {
  it("posts a guarded autonomy tick request", async () => {
    const proposal = tradeProposal();
    const fetch = vi.fn(async () =>
      Response.json({
        ok: true,
        message: "Autonomy tick prepared 1 policy-approved idea.",
        venue: "hyperliquid_testnet",
        scannedMarkets: 80,
        consideredMarkets: 70,
        proposals: [
          {
            proposal,
            duplicate: false,
            execution: {
              placed: false,
              message: "The protected Hyperliquid practice connection is not ready.",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await runAgentAutonomyTickClient({
      walletName: "agent vault",
      agentId: "agent-alpha",
      maxMarkets: 80,
      maxIdeas: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.proposals?.[0]?.proposal.id).toBe("proposal-1");
    expect(result.proposals?.[0]?.execution?.placed).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "/api/agent-autonomy/agent%20vault/tick",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          agentId: "agent-alpha",
          venue: "hyperliquid_testnet",
          maxMarkets: 80,
          maxIdeas: 1,
        }),
      }),
    );
  });

  it("surfaces backend autonomy errors", async () => {
    const fetch = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: "Agent state requires Redis in production.",
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetch);

    const result = await runAgentAutonomyTickClient({
      walletName: "agent vault",
    });

    expect(result.ok).toBe(false);
    expect(result.message).toBe("Agent state requires Redis in production.");
  });
});

function tradeProposal(): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName: "agent vault",
    agentId: "agent-alpha",
    venue: "hyperliquid_testnet",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "65000",
    confidence: 72,
    expiresAt: 1_780_000_000_000,
    status: "approved",
    createdAt: 1,
    updatedAt: 1,
    version: 1,
  };
}
