import { describe, expect, it } from "vitest";
import {
  buildTradingLaunchState,
  buildTradingLaunchSteps,
  type TradingLaunchChecks,
} from "@/lib/agents/launchReadiness";

const ready: TradingLaunchChecks = {
  hasTrader: true,
  traderActive: true,
  planReady: true,
  safetyReady: true,
  allowanceReady: true,
  disclosuresAccepted: true,
  automaticTradingOn: true,
  accountReady: true,
  accountFunded: true,
  protectedConnectionReady: true,
  hasTraderIdea: true,
  firstTradePlaced: true,
};

describe("trading launch readiness", () => {
  it("keeps built-in practice focused on the trader and first idea", () => {
    const steps = buildTradingLaunchSteps("mock_perps", {
      ...ready,
      hasTraderIdea: false,
      firstTradePlaced: false,
    });

    expect(steps.map((step) => step.id)).toEqual([
      "trader",
      "plan",
      "safety",
      "allowance",
      "disclosures",
      "automatic",
      "first_idea",
      "first_trade",
    ]);
    expect(steps.find((step) => step.id === "first_idea")?.status).toBe("current");
  });

  it("requires disclosures before automatic trading", () => {
    const steps = buildTradingLaunchSteps("mock_perps", {
      ...ready,
      disclosuresAccepted: false,
      automaticTradingOn: false,
      hasTraderIdea: false,
      firstTradePlaced: false,
    });

    expect(steps.find((step) => step.id === "disclosures")?.status).toBe("current");
    expect(steps.find((step) => step.id === "automatic")?.status).toBe("waiting");
  });

  it("requires the outside account, funding, and protected connection", () => {
    const steps = buildTradingLaunchSteps("hyperliquid_testnet", {
      ...ready,
      accountFunded: false,
      protectedConnectionReady: false,
      hasTraderIdea: false,
      firstTradePlaced: false,
    });

    expect(steps.find((step) => step.id === "account")?.status).toBe("done");
    expect(steps.find((step) => step.id === "funding")?.status).toBe("current");
    expect(steps.find((step) => step.id === "protected_connection")?.status).toBe(
      "waiting",
    );
    expect(
      steps.findIndex((step) => step.id === "automatic"),
    ).toBeGreaterThan(
      steps.findIndex((step) => step.id === "protected_connection"),
    );
  });

  it("summarizes the current next action for the trading desk", () => {
    const state = buildTradingLaunchState("hyperliquid_testnet", {
      ...ready,
      protectedConnectionReady: false,
      automaticTradingOn: false,
      hasTraderIdea: false,
      firstTradePlaced: false,
    });

    expect(state.complete).toBe(false);
    expect(state.currentStep?.id).toBe("protected_connection");
    expect(state.statusLabel).toBe("Host setup needed");
    expect(state.statusTone).toBe("blocked");
    expect(state.completedSteps).toBe(7);
    expect(state.totalSteps).toBe(11);
  });
});
