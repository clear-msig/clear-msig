import { describe, expect, it } from "vitest";
import {
  buildHyperliquidTestnetKillSwitchRequest,
  buildHyperliquidTestnetExecutorRequest,
  fetchHyperliquidTestnetAccountSnapshot,
  normalizeHyperliquidTestnetKillSwitchArtifact,
  normalizeHyperliquidTestnetOrderArtifact,
  probeHyperliquidTestnetAccount,
  probeHyperliquidTestnetExecutor,
  submitHyperliquidTestnetKillSwitch,
  submitHyperliquidTestnetOrder,
} from "@/lib/agents/serverHyperliquidTestnet";
import { readHyperliquidTestnetExecutorConfig } from "@/lib/agents/hyperliquidTestnetConfig";
import type { AgentServerExecutionRequest } from "@/lib/agents";

const request: AgentServerExecutionRequest = {
  walletName: "vault",
  agentId: "agent-alpha",
  proposalId: "proposal-1",
  venue: "hyperliquid_testnet",
  market: "BTC-PERP",
  side: "long",
  orderType: "market",
  notionalUsd: "250",
  leverage: 1,
  approvedAt: 1_780_000_000_000,
};

const config = {
  accountAddress: "0x1111111111111111111111111111111111111111",
  agentWalletAddress: "0x2222222222222222222222222222222222222222",
  executorUrl: "http://127.0.0.1:4010",
  executorToken: "executor-secret",
};

describe("Hyperliquid testnet server boundary", () => {
  it("requires a valid isolated executor configuration", () => {
    expect(readHyperliquidTestnetExecutorConfig({}).config).toBeNull();
    expect(
      readHyperliquidTestnetExecutorConfig({
        CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS: config.accountAddress,
        CLEARSIG_HYPERLIQUID_TESTNET_AGENT_WALLET_ADDRESS: config.agentWalletAddress,
        CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL: config.executorUrl,
        CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN: config.executorToken,
      }).config,
    ).toEqual(config);
  });

  it("builds a stable idempotent executor request", () => {
    const first = buildHyperliquidTestnetExecutorRequest(request, config);
    const second = buildHyperliquidTestnetExecutorRequest(request, config);

    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.accountAddress).toBe(config.accountAddress);
    expect(first.agentWalletAddress).toBe(config.agentWalletAddress);
    expect(first.controls.maxSlippageBps).toBe(50);
  });

  it("builds a stable kill-switch request for the protected executor", () => {
    const first = buildHyperliquidTestnetKillSwitchRequest({
      walletName: "vault",
      reason: "Owner paused agent trading.",
      config,
    });
    const second = buildHyperliquidTestnetKillSwitchRequest({
      walletName: "vault",
      reason: "Owner paused agent trading.",
      config,
    });

    expect(first).toEqual(second);
    expect(first.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.accountAddress).toBe(config.accountAddress);
    expect(first.agentWalletAddress).toBe(config.agentWalletAddress);
    expect(first.reason).toBe("Owner paused agent trading.");
  });

  it("probes a funded public testnet account without a private key", async () => {
    const probe = await probeHyperliquidTestnetAccount({
      accountAddress: config.accountAddress,
      fetchImpl: async (_url, init) => {
        expect(init?.headers).not.toHaveProperty("authorization");
        return new Response(
          JSON.stringify({
            marginSummary: { accountValue: "1000" },
            withdrawable: "800",
            assetPositions: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(probe.state).toBe("funded");
    expect(probe.accountValueUsd).toBe("1000");
  });

  it("reconciles account value, open positions, and unrealized PnL", async () => {
    const snapshot = await fetchHyperliquidTestnetAccountSnapshot({
      accountAddress: config.accountAddress,
      now: 1_780_000_002_000,
      fetchImpl: async (_url, init) => {
        expect(init?.headers).not.toHaveProperty("authorization");
        return new Response(
          JSON.stringify({
            marginSummary: {
              accountValue: "1250.5",
              totalNtlPos: "60658",
            },
            withdrawable: "900.25",
            assetPositions: [
              {
                position: {
                  coin: "BTC",
                  szi: "0.1",
                  entryPx: "60000",
                  positionValue: "6065.8",
                  unrealizedPnl: "65.8",
                  returnOnEquity: "0.0109",
                  liquidationPx: "45000",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(snapshot.state).toBe("funded");
    expect(snapshot.accountValueUsd).toBe("1250.5");
    expect(snapshot.withdrawableUsd).toBe("900.25");
    expect(snapshot.totalPositionValueUsd).toBe("60658");
    expect(snapshot.unrealizedPnlUsd).toBe("65.8");
    expect(snapshot.positions).toEqual([
      {
        market: "BTC-PERP",
        side: "long",
        size: "0.1",
        entryPriceUsd: "60000",
        positionValueUsd: "6065.8",
        unrealizedPnlUsd: "65.8",
        returnOnEquityPct: "1.09",
        liquidationPriceUsd: "45000",
      },
    ]);
  });

  it("confirms the protected connection is reachable and uses the expected account", async () => {
    const probe = await probeHyperliquidTestnetExecutor({
      config,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            network: "testnet",
            accountAddress: config.accountAddress,
            agentWalletAddress: config.agentWalletAddress,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    });

    expect(probe.state).toBe("ready");
    expect(probe.accountAddress).toBe(config.accountAddress);
    expect(probe.agentWalletAddress).toBe(config.agentWalletAddress);
  });

  it("submits only to the isolated executor and validates its artifact", async () => {
    const artifact = await submitHyperliquidTestnetOrder({
      request,
      config,
      fetchImpl: async (url, init) => {
        expect(url).toBe(
          "http://127.0.0.1:4010/v1/hyperliquid/testnet/orders",
        );
        expect(init?.headers).toMatchObject({
          authorization: "Bearer executor-secret",
        });
        const body = JSON.parse(String(init?.body));
        expect(body.intent.proposalId).toBe("proposal-1");
        expect(body.accountAddress).toBe(config.accountAddress);
        expect(body.agentWalletAddress).toBe(config.agentWalletAddress);
        return new Response(
          JSON.stringify({
            artifact: {
              exchange: "hyperliquid_testnet",
              orderId: "123456",
              status: "accepted",
              market: "BTC-PERP",
              side: "long",
              submittedAt: 1_780_000_001_000,
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(artifact.orderId).toBe("123456");
  });

  it("submits kill switch only to the isolated executor", async () => {
    const artifact = await submitHyperliquidTestnetKillSwitch({
      walletName: "vault",
      reason: "Owner paused agent trading.",
      config,
      fetchImpl: async (url, init) => {
        expect(url).toBe(
          "http://127.0.0.1:4010/v1/hyperliquid/testnet/kill-switch",
        );
        expect(init?.headers).toMatchObject({
          authorization: "Bearer executor-secret",
        });
        const body = JSON.parse(String(init?.body));
        expect(body.walletName).toBe("vault");
        expect(body.accountAddress).toBe(config.accountAddress);
        expect(body.agentWalletAddress).toBe(config.agentWalletAddress);
        return new Response(
          JSON.stringify({
            artifact: {
              exchange: "hyperliquid_testnet",
              status: "cancelled",
              cancelledAt: 1_780_000_001_000,
              message: "Open orders cancelled.",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    expect(artifact.status).toBe("cancelled");
  });

  it("rejects mismatched or fabricated exchange artifacts", () => {
    expect(() =>
      normalizeHyperliquidTestnetOrderArtifact(
        {
          exchange: "hyperliquid_testnet",
          orderId: "123456",
          status: "accepted",
          market: "ETH-PERP",
          side: "long",
          submittedAt: 1_780_000_001_000,
        },
        request,
      ),
    ).toThrow("invalid order artifact");
    expect(() =>
      normalizeHyperliquidTestnetKillSwitchArtifact({
        exchange: "hyperliquid_testnet",
        status: "cancelled",
        cancelledAt: 0,
        message: "Bad timestamp.",
      }),
    ).toThrow("invalid kill-switch artifact");
  });
});
