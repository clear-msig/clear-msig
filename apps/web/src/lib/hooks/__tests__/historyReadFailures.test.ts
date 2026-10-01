import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useRecentActivity } from "../useRecentActivity";
import { useUserIntents } from "../useUserIntents";
vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn(),
  useQueries: vi.fn(),
}));
vi.mock("@/lib/wallet", () => ({
  useWallet: () => ({ publicKey: { toBase58: () => "owner" } }),
  useConnection: () => ({
    connection: { rpcEndpoint: "https://rpc.fixture.invalid" },
  }),
}));
function result(data: unknown, error: unknown = null) {
  return {
    data,
    error,
    isLoading: false,
    isFetching: false,
    dataUpdatedAt: 1,
    status: error ? "error" : "success",
    refetch: vi.fn(async () => ({ data })),
  };
}
function run<T>(hook: () => T): T {
  let output!: T;
  function Probe() {
    output = hook();
    return null;
  }
  renderToStaticMarkup(createElement(Probe));
  return output;
}
beforeEach(() => vi.resetAllMocks());
describe("history read failure propagation", () => {
  it.each([useRecentActivity, useUserIntents])(
    "retains membership failure rather than claiming a complete empty feed",
    async (hook) => {
      const failure = new Error("Membership RPC unavailable");
      const membership = result(undefined, failure);
      vi.mocked(useQuery).mockReturnValue(membership as never);
      vi.mocked(useQueries).mockReturnValue([] as never);
      const output = run(() => hook());
      expect(output.error).toBe(failure);
      expect(output.rows).toEqual([]);
      await output.refresh();
      expect(membership.refetch).toHaveBeenCalledOnce();
    },
  );
  it.each([useRecentActivity, useUserIntents])(
    "scopes wallet and list caches to the RPC endpoint and exposes chain failures",
    (hook) => {
      const membership = { wallet: "wallet", wallet_name: "Team" };
      const failure = new Error("Chain read unavailable");
      vi.mocked(useQuery).mockReturnValue(result([membership]) as never);
      vi.mocked(useQueries)
        .mockReturnValueOnce([
          result({
            membership,
            account: { intentIndex: 4, proposalIndex: 1n },
          }),
        ] as never)
        .mockReturnValueOnce([result(undefined, failure)] as never);
      expect(run(() => hook()).error).toBe(failure);
      for (const call of vi.mocked(useQueries).mock.calls) {
        const config = call[0] as { queries: Array<{ queryKey: unknown[] }> };
        expect(config.queries[0].queryKey).toContain(
          "https://rpc.fixture.invalid",
        );
      }
    },
  );
  it("carries typed action identity into activity rows", () => {
    const membership = { wallet: "wallet", wallet_name: "Team" };
    vi.mocked(useQuery).mockReturnValue(result([membership]) as never);
    vi.mocked(useQueries)
      .mockReturnValueOnce([
        result({ membership, account: { intentIndex: 4, proposalIndex: 1n } }),
      ] as never)
      .mockReturnValueOnce([
        result({
          membership,
          rows: [
            {
              pda: { toBase58: () => "proposal" },
              proposalIndex: 1n,
              intentIndex: 3,
              account: {
                actionKind: 5,
                status: 2,
                statusLabel: "Executed",
                proposedAt: 1n,
                approvalBitmap: 3,
                proposer: "author",
              },
            },
          ],
        }),
      ] as never);
    expect(run(() => useRecentActivity()).rows[0].intentTemplate).toBe(
      "TypedUpdateThreshold",
    );
  });
});
