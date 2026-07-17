import { describe, expect, it } from "vitest";
import { verifyHyperliquidTestnetSettlementEvidence } from "@/lib/agents/hyperliquidSettlementEvidence";

const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_B = `0x${"bb".repeat(32)}`;
const claim = {
  accountAddress: "0x1111111111111111111111111111111111111111",
  closingOrderId: "654321",
  market: "BTC-PERP",
  side: "long" as const,
  closedSize: "0.0037",
  realizedPnlUsd: "-1.25",
  fillHashes: [HASH_A, HASH_B],
  settledAt: 1_780_000_002_000,
  queryStartTime: 1_780_000_001_000,
};

describe("Hyperliquid native settlement evidence", () => {
  it("derives exact size and P/L from independently queried venue fills", async () => {
    const verified = await verifyHyperliquidTestnetSettlementEvidence({
      claim,
      fetchImpl: venueFetch(),
      sleep: async () => undefined,
    });

    expect(verified.closedSize).toBe("0.0037");
    expect(verified.realizedPnlUsd).toBe("-1.25");
    expect(verified.fillHashes).toEqual([HASH_A, HASH_B]);
    expect(verified.venueEvidence.fills).toHaveLength(2);
    expect(verified.venueEvidence.evidenceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects executor accounting that differs from native fills", async () => {
    await expect(verifyHyperliquidTestnetSettlementEvidence({
      claim: { ...claim, realizedPnlUsd: "9.99" },
      fetchImpl: venueFetch(),
      sleep: async () => undefined,
    })).rejects.toThrow(/do not match Hyperliquid native fill evidence/);
  });

  it("rejects fills for the wrong direction even when the order id matches", async () => {
    await expect(verifyHyperliquidTestnetSettlementEvidence({
      claim,
      fetchImpl: venueFetch("Close Short"),
      sleep: async () => undefined,
    })).rejects.toThrow(/no matching native fills/);
  });
});

function venueFetch(direction = "Close Long"): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.type === "orderStatus") {
      return json({
        status: "order",
        order: {
          order: { coin: "BTC", oid: 654321, side: "A" },
          status: "filled",
          statusTimestamp: 1_780_000_002_000,
        },
      });
    }
    return json([
      {
        closedPnl: "-1",
        coin: "BTC",
        dir: direction,
        hash: HASH_A,
        oid: 654321,
        px: "67162.25",
        side: "A",
        sz: "0.0015",
        time: 1_780_000_001_900,
        tid: 998876,
      },
      {
        closedPnl: "-0.25",
        coin: "BTC",
        dir: direction,
        hash: HASH_B,
        oid: 654321,
        px: "67160",
        side: "A",
        sz: "0.0022",
        time: 1_780_000_002_000,
        tid: 998877,
      },
    ]);
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
