import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_VENUE_REALTIME_POLL_MS,
  loadAgentVenueReadinessForAgents,
  loadAgentVenueReadiness,
  reconcileAgentVenueRequest,
  startAgentVenueReadinessPolling,
  submitAgentVenueExecution,
} from "@/lib/agents/clientExecution";
import type { AgentTradeProposal } from "@/lib/agents";

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
  confidence: 72,
  expiresAt: Date.now() + 60_000,
  status: "approved",
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_100,
  version: 1,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("client execution handoff", () => {
  it("loads venue readiness", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response({
        ok: true,
        readiness: {
          venue: "hyperliquid_testnet",
          label: "Hyperliquid Testnet",
          state: "not_configured",
          canSubmit: false,
          missingEnvVars: ["CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN"],
          message: "Server trading is not configured for this venue yet.",
        },
        accountProbe: {
          state: "empty",
          accountAddress: "0x1111111111111111111111111111111111111111",
          accountValueUsd: "0",
          withdrawableUsd: "0",
          openPositions: 0,
          message: "Hyperliquid testnet account is reachable but has no trading collateral.",
        },
        accountSnapshot: {
          state: "funded",
          accountAddress: "0x1111111111111111111111111111111111111111",
          accountValueUsd: "1000",
          withdrawableUsd: "800",
          totalPositionValueUsd: "250",
          unrealizedPnlUsd: "12.5",
          positions: [
            {
              market: "BTC-PERP",
              side: "long",
              size: "0.01",
              entryPriceUsd: "60000",
              positionValueUsd: "606.58",
              unrealizedPnlUsd: "12.5",
              returnOnEquityPct: "2.1",
              liquidationPriceUsd: "45000",
            },
          ],
          observedAt: 1_780_000_000_000,
          message: "Hyperliquid testnet account is reachable and funded.",
        },
        requests: [
          {
            id: "request-1",
            status: "submitted",
            message: "Hyperliquid testnet order 123 was filled.",
            readinessState: "ready",
            artifact: {
              exchange: "hyperliquid_testnet",
              orderId: "123",
              status: "filled",
              market: "BTC-PERP",
              side: "long",
              submittedAt: 1_780_000_001_000,
            },
            createdAt: 1_780_000_001_000,
            updatedAt: 1_780_000_001_000,
            request: {
              walletName: "vault",
              agentId: "agent-alpha",
              proposalId: "proposal-1",
              venue: "hyperliquid_testnet",
              market: "BTC-PERP",
              side: "long",
              notionalUsd: "250",
              leverage: 1,
            },
          },
        ],
      })),
    );

    const readiness = await loadAgentVenueReadiness("hyperliquid_testnet");

    expect(readiness?.state).toBe("not_configured");
    expect(readiness?.accountProbe?.state).toBe("empty");
    expect(readiness?.accountSnapshot?.positions[0]?.market).toBe("BTC-PERP");
    expect(readiness?.requests?.[0]?.artifact?.orderId).toBe("123");
    expect(fetch).toHaveBeenCalledWith("/api/agent-execution/hyperliquid_testnet");
  });

  it("loads venue readiness for a pasted public account address", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        ok: true,
        readiness: {
          venue: "hyperliquid_testnet",
          label: "Hyperliquid Testnet",
          state: "ready",
          canSubmit: true,
          missingEnvVars: [],
          message: "Ready.",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await loadAgentVenueReadiness("hyperliquid_testnet", {
      accountAddress: "0x1111111111111111111111111111111111111111",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-execution/hyperliquid_testnet?accountAddress=0x1111111111111111111111111111111111111111",
    );
  });

  it("submits an approved proposal as a server execution request", async () => {
    const fetchMock = vi.fn(async () =>
      response(
        {
          error: "Server trading is not configured for this venue yet.",
          readiness: {
            venue: "hyperliquid_testnet",
            label: "Hyperliquid Testnet",
            state: "not_configured",
            canSubmit: false,
            missingEnvVars: ["CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN"],
            message: "Server trading is not configured for this venue yet.",
          },
          serverRequest: {
            id: "server-request-1",
            status: "waiting_for_setup",
            message: "Server trading is not configured for this venue yet.",
          },
          duplicate: false,
        },
        { status: 503 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await submitAgentVenueExecution(proposal);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.message).toBe("Server trading is not configured for this venue yet.");
    expect(result.serverRequest?.id).toBe("server-request-1");
    expect(result.duplicate).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/agent-execution/hyperliquid_testnet",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletName: "vault",
          agentId: "agent-alpha",
          proposalId: "proposal-1",
          venue: "hyperliquid_testnet",
          market: "BTC-PERP",
          side: "long",
          orderType: "market",
          notionalUsd: "250",
          leverage: 1,
          approvedAt: 1_700_000_100,
        }),
      }),
    );
  });

  it("reconciles submitted venue requests against live account positions", () => {
    const request = {
      status: "submitted",
      message: "Order filled.",
      request: {
        walletName: "vault",
        agentId: "agent-alpha",
        proposalId: "proposal-1",
        venue: "hyperliquid_testnet" as const,
        market: "BTC-PERP",
        side: "long" as const,
        notionalUsd: "250",
        leverage: 1,
      },
    };
    const accountSnapshot = {
      state: "funded" as const,
      accountAddress: "0x1111111111111111111111111111111111111111",
      accountValueUsd: "1000",
      withdrawableUsd: "800",
      totalPositionValueUsd: "250",
      unrealizedPnlUsd: "12.5",
      positions: [
        {
          market: "BTC-PERP",
          side: "long" as const,
          size: "0.01",
          entryPriceUsd: "60000",
          positionValueUsd: "606.58",
          unrealizedPnlUsd: "12.5",
          returnOnEquityPct: "2.1",
          liquidationPriceUsd: "45000",
        },
      ],
      observedAt: 1_780_000_000_000,
      message: "Hyperliquid testnet account is reachable and funded.",
    };

    expect(reconcileAgentVenueRequest(request, accountSnapshot).state).toBe("open_on_venue");
    expect(
      reconcileAgentVenueRequest(
        {
          ...request,
          artifact: {
            exchange: "hyperliquid_testnet",
            orderId: "order-1",
            status: "filled",
            market: "ETH-PERP",
            side: "long",
            submittedAt: 1,
          },
          request: { ...request.request, market: "ETH-PERP" },
        },
        accountSnapshot,
      ).state,
    ).toBe("not_found");
    expect(reconcileAgentVenueRequest(request, null).state).toBe(
      "waiting_for_account",
    );
  });

  it("aggregates venue requests across agents", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) =>
      response({
        ok: true,
        readiness: {
          venue: "hyperliquid_testnet",
          label: "Hyperliquid Testnet",
          state: "ready",
          canSubmit: true,
          missingEnvVars: [],
          message: "Ready.",
        },
        reconciliation: {
          venue: "hyperliquid_testnet",
          status: "healthy",
          label: "Reconciled",
          message: "Submitted requests match the latest venue state.",
          totalRequests: 1,
          submittedRequests: 1,
          pendingRequests: 0,
          rejectedRequests: 0,
          adapterErrors: 0,
          openRequests: 1,
          exchangeOpenPositions: 1,
          missingOrderIds: 0,
          unmatchedPositions: 0,
          staleSnapshot: false,
          checkedAt: 1,
          issues: [],
        },
        requests: [
          {
            id: String(url).includes("agentId=agent-a") ? "request-a" : "request-b",
            status: "submitted",
            request: {
              walletName: "vault",
              agentId: String(url).includes("agentId=agent-a") ? "agent-a" : "agent-b",
              proposalId: "proposal-1",
              venue: "hyperliquid_testnet",
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const readiness = await loadAgentVenueReadinessForAgents("hyperliquid_testnet", {
      walletName: "vault",
      agentIds: ["agent-a", "agent-b"],
      accountAddress: "0xabc",
    });

    expect(readiness?.requests).toHaveLength(2);
    expect(readiness?.reconciliation?.submittedRequests).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls venue readiness on the real-time cadence", async () => {
    vi.useFakeTimers();
    const updates: Array<string | null> = [];
    const stop = startAgentVenueReadinessPolling({
      venue: "hyperliquid_testnet",
      intervalMs: AGENT_VENUE_REALTIME_POLL_MS,
      load: vi
        .fn()
        .mockResolvedValueOnce({ label: "first" })
        .mockResolvedValueOnce({ label: "second" }),
      onUpdate: (readiness) => updates.push(readiness?.label ?? null),
    });

    await vi.runOnlyPendingTimersAsync();
    expect(updates).toEqual(["first", "second"]);
    stop();
    vi.useRealTimers();
  });
});

function response(body: unknown, init: { status?: number } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Service Unavailable",
    json: async () => body,
  } as Response;
}
