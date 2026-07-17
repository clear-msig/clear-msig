import { describe, expect, it } from "vitest";
import {
  normalizeServerExecutionRequest,
  serverAgentExecutionReadiness,
  serverExecutionRequestFromProposal,
  type AgentTradeProposal,
} from "@/lib/agents";

const proposal: AgentTradeProposal = {
  id: "proposal-1",
  walletName: "vault",
  agentId: "agent-alpha",
  venue: "hyperliquid_testnet",
  market: "BTC-PERP",
  side: "long",
  orderType: "market",
  notionalUsd: "250",
  leverage: 1,
  stopLossPrice: "65000",
  takeProfitPrice: null,
  thesis: "Momentum breakout.",
  confidence: 72,
  expiresAt: Date.now() + 60_000,
  status: "approved",
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: 1,
};

describe("server execution adapters", () => {
  it("marks paper venues as local only", () => {
    const readiness = serverAgentExecutionReadiness("mock_perps", {});

    expect(readiness.state).toBe("local_only");
    expect(readiness.canSubmit).toBe(false);
    expect(readiness.missingEnvVars).toEqual([]);
  });

  it("reports missing server env for Hyperliquid testnet", () => {
    const readiness = serverAgentExecutionReadiness("hyperliquid_testnet", {});

    expect(readiness.state).toBe("not_configured");
    expect(readiness.canSubmit).toBe(false);
    expect(readiness.missingEnvVars).toEqual([
      "CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS",
      "CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS",
      "CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL",
      "CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN",
    ]);
  });

  it("marks Hyperliquid testnet ready when server keys are present", () => {
    const readiness = serverAgentExecutionReadiness("hyperliquid_testnet", {
      CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS:
        "0x1111111111111111111111111111111111111111",
      CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS:
        "0x2222222222222222222222222222222222222222",
      CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL: "http://127.0.0.1:4010",
      CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN: "secret",
    });

    expect(readiness.state).toBe("ready");
    expect(readiness.canSubmit).toBe(true);
    expect(readiness.missingEnvVars).toEqual([]);
  });

  it("rejects invalid Hyperliquid testnet executor configuration", () => {
    const readiness = serverAgentExecutionReadiness("hyperliquid_testnet", {
      CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS: "0xabc",
      CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS: "0xabc",
      CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL: "not-a-url",
      CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN: "secret",
    });

    expect(readiness.state).toBe("not_configured");
    expect(readiness.configurationErrors).toHaveLength(3);
  });

  it("builds and validates a server execution request from an approved proposal", () => {
    const request = serverExecutionRequestFromProposal(proposal, 1_700_000_000);
    const parsed = normalizeServerExecutionRequest(request);

    expect(parsed.errors).toEqual([]);
    expect(parsed.request).toEqual({
      walletName: "vault",
      agentId: "agent-alpha",
      proposalId: "proposal-1",
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      approvedAt: 1_700_000_000,
    });
  });

  it("rejects malformed server execution requests", () => {
    const parsed = normalizeServerExecutionRequest({
      walletName: "vault",
      venue: "hyperliquid_testnet",
      side: "buy",
      orderType: "market",
      notionalUsd: "-1",
      leverage: 0,
    });

    expect(parsed.request).toBeNull();
    expect(parsed.errors).toContain("agentId is required.");
    expect(parsed.errors).toContain("side must be long or short.");
    expect(parsed.errors).toContain("notionalUsd must be a positive number.");
  });
});
