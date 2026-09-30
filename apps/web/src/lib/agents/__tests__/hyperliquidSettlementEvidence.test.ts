import { describe, expect, it } from "vitest";
import {
  assertVerifiedHyperliquidSettlement,
  verifyHyperliquidTestnetSettlementEvidence,
} from "@/lib/agents/hyperliquidSettlementEvidence";

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
    await expect(
      verifyHyperliquidTestnetSettlementEvidence({
        claim: { ...claim, realizedPnlUsd: "9.99" },
        fetchImpl: venueFetch(),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/do not match Hyperliquid native fill evidence/);
  });

  it("rejects fills for the wrong direction even when the order id matches", async () => {
    await expect(
      verifyHyperliquidTestnetSettlementEvidence({
        claim,
        fetchImpl: venueFetch("Close Short"),
        sleep: async () => undefined,
      }),
    ).rejects.toThrow(/no matching native fills/);
  });
});

function venueFetch(direction = "Close Long"): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    if (body.type === "orderStatus") {
      return json({
        status: "order",
        order: {
          order: {
            coin: "BTC",
            oid: 654321,
            side: "A",
            origSz: "0.0037",
            sz: "0",
            reduceOnly: true,
          },
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

describe("complete native settlement evidence", () => {
  const mutatedFetch =
    (mutate: (type: string, value: unknown) => unknown): typeof fetch =>
    async (url, init) => {
      const type = JSON.parse(String(init?.body)).type;
      const original = await venueFetch()(url, init);
      return json(mutate(type, await original.json()));
    };
  it("uses numeric order IDs and prohibits redirects", async () => {
    await verifyHyperliquidTestnetSettlementEvidence({
      claim,
      fetchImpl: async (url, init) => {
        expect(String(url)).toBe("https://api.hyperliquid-testnet.xyz/info");
        expect(init?.redirect).toBe("error");
        const body = JSON.parse(String(init?.body));
        if (body.type === "orderStatus") expect(body.oid).toBe(654321);
        return venueFetch()(url, init);
      },
    });
  });
  it.each(["duplicate", "missing", "truncated"])(
    "rejects %s fills",
    async (kind) => {
      await expect(
        verifyHyperliquidTestnetSettlementEvidence({
          claim,
          sleep: async () => undefined,
          fetchImpl: mutatedFetch((type, value) => {
            if (type !== "userFillsByTime") return value;
            const fills = value as unknown[];
            return kind === "duplicate"
              ? [fills[0], fills[0], fills[1]]
              : kind === "missing"
                ? [fills[0]]
                : Array.from({ length: 2000 }, () => fills[0]);
          }),
        }),
      ).rejects.toThrow(/Duplicate|complete|truncated/);
    },
  );
  it("rejects a partial-fill claim even when its claimed accounting agrees with the subset", async () => {
    await expect(
      verifyHyperliquidTestnetSettlementEvidence({
        claim: {
          ...claim,
          closedSize: "0.0015",
          realizedPnlUsd: "-1",
          fillHashes: [HASH_A],
          settledAt: 1780000001900,
        },
        fetchImpl: mutatedFetch((type, value) =>
          type === "userFillsByTime" ? [(value as unknown[])[0]] : value,
        ),
      }),
    ).rejects.toThrow("complete closing order");
  });
  it("rejects changed verified objects and caller-created copies", async () => {
    const verified = await verifyHyperliquidTestnetSettlementEvidence({
      claim,
      fetchImpl: venueFetch(),
    });
    expect(() => assertVerifiedHyperliquidSettlement(verified)).not.toThrow();
    expect(() =>
      assertVerifiedHyperliquidSettlement(structuredClone(verified)),
    ).toThrow("Fresh independently");
    verified.realizedPnlUsd = "100";
    expect(() => assertVerifiedHyperliquidSettlement(verified)).toThrow(
      "Fresh independently",
    );
  });
  it("fails before network for inexact order IDs and invalid query bounds", async () => {
    const fetchImpl: typeof fetch = async () => {
      throw new Error("must not fetch");
    };
    await expect(
      verifyHyperliquidTestnetSettlementEvidence({
        claim: { ...claim, closingOrderId: "9007199254740993" },
        fetchImpl,
      }),
    ).rejects.toThrow("lossless u64");
    await expect(
      verifyHyperliquidTestnetSettlementEvidence({
        claim: { ...claim, queryStartTime: claim.settledAt + 1 },
        fetchImpl,
      }),
    ).rejects.toThrow("bounds");
  });
});
