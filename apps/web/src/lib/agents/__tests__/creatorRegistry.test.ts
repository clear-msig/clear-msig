import { describe, expect, it } from "vitest";
import {
  buildAgentCreatorRegistryReadiness,
  creatorRegistryStatusLabel,
} from "@/lib/agents/creatorRegistry";

describe("agent creator registry readiness", () => {
  it("marks a fully evidenced external agent as registry ready", () => {
    const readiness = buildAgentCreatorRegistryReadiness({
      creatorType: "external",
      name: "Alpha",
      summary: "External momentum agent.",
      allowedMarkets: ["BTC-PERP"],
      supportedVenues: ["hyperliquid_testnet"],
      identityPubkey: "alpha-signing-key",
      reviewedAt: Date.UTC(2026, 5, 1),
      lanes: [{ hasHistory: true }],
      recentDecisions: [
        {
          summary: "BTC reclaimed support.",
          riskPlan: "Stop below support.",
          exitPlan: "Exit at target or invalidation.",
          evidence: ["technical"],
        },
      ],
      disclosures: ["custody", "execution", "performance", "automation"],
    });

    expect(readiness).toMatchObject({
      status: "ready",
      score: 100,
      headline: "Ready for the public agent registry",
    });
    expect(creatorRegistryStatusLabel(readiness.status)).toBe("Registry ready");
  });

  it("blocks external agents without signing identity or observed performance", () => {
    const readiness = buildAgentCreatorRegistryReadiness({
      creatorType: "external",
      name: "Alpha",
      summary: "External momentum agent.",
      allowedMarkets: ["BTC-PERP"],
      supportedVenues: ["hyperliquid_testnet"],
      lanes: [{ hasHistory: false }],
      recentDecisions: [],
      disclosures: ["custody", "execution", "performance", "automation"],
    });

    expect(readiness.status).toBe("blocked");
    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "signing-identity", status: "block" }),
        expect.objectContaining({ id: "observed-performance", status: "block" }),
      ]),
    );
  });

  it("lets prepared ClearSig agents rely on app-managed identity", () => {
    const readiness = buildAgentCreatorRegistryReadiness({
      creatorType: "clearsig_prepared",
      name: "Prepared Alpha",
      summary: "Prepared trader.",
      allowedMarkets: ["ETH-PERP"],
      supportedVenues: ["mock_perps"],
      reviewedAt: Date.UTC(2026, 5, 1),
      lanes: [{ hasHistory: true }],
      recentDecisions: [
        {
          summary: "ETH trend entry.",
          riskPlan: "Stop fast.",
          exitPlan: "Take profit at target.",
          evidence: ["strategy"],
        },
      ],
      disclosures: ["custody", "execution", "performance", "automation"],
    });

    expect(readiness.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "signing-identity", status: "pass" }),
      ]),
    );
  });
});
