import { describe, expect, it } from "vitest";
import {
  CLEARSIG_TRADER_LIBRARY,
  createClearSigLibraryPracticeIdea,
  createClearSigLibraryTrader,
} from "@/lib/agents/traderLibrary";
import { defaultAgentVaultPolicy, evaluateAgentTradeProposal } from "@/lib/agents/policy";
import { bindAgentSessionPolicyHash } from "@/lib/agents/policyHash";

describe("ClearSig Trader Library", () => {
  it("offers complete and distinct prepared traders", () => {
    expect(CLEARSIG_TRADER_LIBRARY).toHaveLength(3);
    expect(new Set(CLEARSIG_TRADER_LIBRARY.map((trader) => trader.id)).size).toBe(3);
    for (const trader of CLEARSIG_TRADER_LIBRARY) {
      expect(trader.strategy.mode).toBe("paper");
      expect(trader.strategy.allowedMarkets.length).toBeGreaterThan(0);
      expect(trader.strategy.entryRules.length).toBeGreaterThan(10);
      expect(trader.strategy.killSwitchRules.length).toBeGreaterThan(10);
    }
  });

  it("creates a ready prepared trader and keeps its first idea inside the allowance", () => {
    const profile = createClearSigLibraryTrader({
      template: CLEARSIG_TRADER_LIBRARY[0]!,
      walletName: "library-wallet",
      id: "trader-1",
      now: 100,
    });
    const idea = createClearSigLibraryPracticeIdea({
      agent: profile,
      maxNotionalUsd: "75",
      id: "idea-1",
      now: 200,
    });

    expect(profile.libraryTraderId).toBe("steady-btc");
    expect(profile.strategy?.allowedMarkets).toEqual(["BTC-PERP"]);
    expect(idea?.notionalUsd).toBe("75");
    expect(idea?.stopLossPrice).toBeTruthy();
    expect(idea?.takeProfitPrice).toBeTruthy();
    expect(idea?.clientSignalId).toContain("clearsig-library");
  });

  it("sends a prepared first idea through the normal ClearSig safety check", () => {
    const now = 1_000;
    const walletName = "library-wallet-safety";
    const profile = createClearSigLibraryTrader({
      template: CLEARSIG_TRADER_LIBRARY[1]!,
      walletName,
      id: "trader-2",
      now,
    });
    const policy = defaultAgentVaultPolicy(walletName, now);
    const session = bindAgentSessionPolicyHash(
      {
        id: "allowance-1",
        walletName,
        agentId: profile.id,
        status: "active",
        startsAt: now,
        expiresAt: now + 60_000,
        allowedVenues: ["mock_perps"],
        allowedMarkets: ["BTC-PERP", "ETH-PERP", "SOL-PERP"],
        maxNotionalUsd: "150",
        maxLeverage: 1,
        maxOpenPositions: 1,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      policy,
    );
    const idea = createClearSigLibraryPracticeIdea({
      agent: profile,
      maxNotionalUsd: session.maxNotionalUsd,
      id: "idea-2",
      now,
    });

    expect(idea).not.toBeNull();
    expect(
      evaluateAgentTradeProposal({
        agent: profile,
        proposal: idea!,
        policy,
        session,
        risk: { openPositions: 0, dailyRealizedPnlUsd: "0" },
        now,
      }).decision,
    ).toBe("allowed");
  });

  it("can prepare a checked Hyperliquid practice idea without changing the trader", () => {
    const now = 2_000;
    const walletName = "library-hyperliquid-practice";
    const profile = createClearSigLibraryTrader({
      template: CLEARSIG_TRADER_LIBRARY[0]!,
      walletName,
      id: "trader-hyperliquid",
      now,
    });
    const basePolicy = defaultAgentVaultPolicy(walletName, now);
    const policy = {
      ...basePolicy,
      allowedVenues: ["mock_perps", "hyperliquid_testnet"] as const,
    };
    const session = bindAgentSessionPolicyHash(
      {
        id: "allowance-hyperliquid",
        walletName,
        agentId: profile.id,
        status: "active",
        startsAt: now,
        expiresAt: now + 60_000,
        allowedVenues: ["hyperliquid_testnet"],
        allowedMarkets: ["BTC-PERP"],
        maxNotionalUsd: "50",
        maxLeverage: 1,
        maxOpenPositions: 1,
        createdAt: now,
        updatedAt: now,
        version: 1,
      },
      { ...policy, allowedVenues: [...policy.allowedVenues] },
    );
    const idea = createClearSigLibraryPracticeIdea({
      agent: profile,
      venue: "hyperliquid_testnet",
      maxNotionalUsd: session.maxNotionalUsd,
      id: "idea-hyperliquid",
      now,
    });

    expect(idea?.venue).toBe("hyperliquid_testnet");
    expect(
      evaluateAgentTradeProposal({
        agent: profile,
        proposal: idea!,
        policy: { ...policy, allowedVenues: [...policy.allowedVenues] },
        session,
        risk: { openPositions: 0, dailyRealizedPnlUsd: "0" },
        now,
      }).decision,
    ).toBe("allowed");
  });

  it("uses market data when preparing a practice idea", () => {
    const now = 3_000;
    const profile = createClearSigLibraryTrader({
      template: CLEARSIG_TRADER_LIBRARY[0]!,
      walletName: "library-market-data",
      id: "trader-market-data",
      now,
    });
    const idea = createClearSigLibraryPracticeIdea({
      agent: profile,
      id: "idea-market-data",
      now,
      marketData: {
        provider: "hyperliquid",
        source: "live",
        market: "BTC-PERP",
        observedAt: now,
        markPriceUsd: "70000",
        fundingRatePct: "0.01",
        openInterestUsd: "1000000",
        volume24hUsd: "2000000",
      },
    });

    expect(idea?.entryPrice).toBe("70000");
    expect(idea?.thesis).toContain("live BTC-PERP market data");
  });

  it("uses the active allowance leverage for practice perps", () => {
    const now = 4_000;
    const profile = createClearSigLibraryTrader({
      template: CLEARSIG_TRADER_LIBRARY[1]!,
      walletName: "library-leverage",
      id: "trader-leverage",
      now,
    });
    const idea = createClearSigLibraryPracticeIdea({
      agent: profile,
      maxNotionalUsd: "250",
      maxLeverage: 5,
      id: "idea-leverage",
      now,
    });

    expect(idea?.leverage).toBe(5);
    expect(idea?.thesis).toContain("5x max borrowing");
  });
});
