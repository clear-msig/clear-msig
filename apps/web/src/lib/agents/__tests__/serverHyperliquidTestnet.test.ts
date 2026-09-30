import { describe, expect, it, vi } from "vitest";
import {
  buildHyperliquidTestnetKillSwitchRequest,
  buildHyperliquidTestnetExecutorRequest,
  buildHyperliquidTestnetSettlementRequest,
  fetchHyperliquidTestnetAccountSnapshot,
  normalizeHyperliquidTestnetKillSwitchArtifact,
  normalizeHyperliquidTestnetOrderArtifact,
  normalizeHyperliquidTestnetSettlementArtifact,
  probeHyperliquidTestnetAccount,
  probeHyperliquidTestnetExecutor,
  submitHyperliquidTestnetKillSwitch,
  submitHyperliquidTestnetOrder,
  submitHyperliquidTestnetSettlement,
  verifyHyperliquidTestnetSettlementArtifact,
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

  it("gives each kill-switch invocation a fresh cancellation identity", () => {
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

    expect(first.idempotencyKey).not.toBe(second.idempotencyKey);
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

  it("blocks legacy order, close and kill-switch side effects even with configured credentials", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    await expect(submitHyperliquidTestnetOrder({ request, config, fetchImpl })).rejects.toThrow("External agent execution is blocked");
    await expect(submitHyperliquidTestnetKillSwitch({ walletName: "vault", reason: "pause", config, fetchImpl })).rejects.toThrow("External agent execution is blocked");
    await expect(submitHyperliquidTestnetSettlement({
      serverRequestId: "request-1", request, config, fetchImpl,
      openingArtifact: { exchange: "hyperliquid_testnet", orderId: "1", status: "filled",
        market: "BTC-PERP", side: "long", filledSize: "1", submittedAt: 1 },
    })).rejects.toThrow("External agent execution is blocked");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("binds and validates a venue settlement artifact", async () => {
    const openingArtifact = {
      exchange: "hyperliquid_testnet" as const,
      orderId: "123456",
      status: "filled" as const,
      market: "BTC-PERP",
      side: "long" as const,
      filledSize: "0.0037",
      averagePriceUsd: "67500",
      submittedAt: 1_780_000_001_000,
    };
    const built = buildHyperliquidTestnetSettlementRequest({
      serverRequestId: "request-1",
      request,
      openingArtifact,
      config,
    });
    expect(built.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(built.openingArtifact.orderId).toBe("123456");

    const artifact = await verifyHyperliquidTestnetSettlementArtifact({
      serverRequestId: "request-1",
      request,
      openingArtifact,
      config,
      claim: {
        exchange: "hyperliquid_testnet", network: "testnet", serverRequestId: "request-1",
        openingOrderId: "123456", closingOrderId: "654321", market: "BTC-PERP", side: "long",
        closedSize: "0.0037", reservedNotionalUsd: "250", realizedPnlUsd: "-1.25",
        fillHashes: [`0x${"ab".repeat(32)}`], settledAt: 1_780_000_002_000,
      },
      fetchImpl: async (url, init) => {
        expect(url).toBe("https://api.hyperliquid-testnet.xyz/info");
        const body = JSON.parse(String(init?.body));
        if (body.type === "orderStatus") {
          expect(body.user).toBe(config.accountAddress);
          expect(body.oid).toBe("654321");
          return new Response(JSON.stringify({
            status: "order",
            order: {
              order: { coin: "BTC", oid: 654321, side: "A" },
              status: "filled",
              statusTimestamp: 1_780_000_002_000,
            },
          }), { status: 200, headers: { "content-type": "application/json" } });
        }
        expect(body.type).toBe("userFillsByTime");
        return new Response(JSON.stringify([{
          closedPnl: "-1.25",
          coin: "BTC",
          dir: "Close Long",
          hash: `0x${"ab".repeat(32)}`,
          oid: 654321,
          px: "67162.25",
          side: "A",
          sz: "0.0037",
          time: 1_780_000_002_000,
          tid: 998877,
        }]), { status: 200, headers: { "content-type": "application/json" } });
      },
      sleep: async () => undefined,
    });
    expect(artifact.realizedPnlUsd).toBe("-1.25");
    expect(artifact.venueEvidence).toMatchObject({
      source: "hyperliquid_info_api",
      orderStatus: "filled",
      accountAddress: config.accountAddress,
    });
    expect(artifact.venueEvidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);

    expect(() => normalizeHyperliquidTestnetSettlementArtifact(
      { ...artifact, openingOrderId: "fabricated" },
      { serverRequestId: "request-1", request, openingArtifact },
    )).toThrow(/invalid settlement artifact/);
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
