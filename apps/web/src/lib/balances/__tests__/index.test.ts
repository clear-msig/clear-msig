import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "@solana/web3.js";
import { fetchChainBalance } from "@/lib/balances";
import type { ChainBindingResponse } from "@/lib/api/types";

function binding(
  chain_kind: number,
  extra: Partial<ChainBindingResponse>,
): ChainBindingResponse {
  return {
    chain: "test",
    chain_kind,
    ika_config: "ika",
    dwallet: "dwallet",
    user_pubkey_hex: "00",
    signature_scheme: 0,
    ...extra,
  };
}

function mockRpc(result: string = "0x0") {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("fetchChainBalance", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads Hyperliquid balances from the Hyperliquid RPC, not the ETH RPC", async () => {
    const fetchMock = mockRpc("0x2a");
    const result = await fetchChainBalance(
      binding(5, {
        chain: "hyperliquid_evm",
        evm_address: "0x0000000000000000000000000000000000000001",
      }),
      {
        solanaConnection: {} as Connection,
        evmRpcUrl: "https://ethereum.example/rpc",
        hyperliquidRpcUrl: "https://hyperliquid.example/evm",
        zcashRpcUrl: "",
      },
    );

    expect(result?.raw).toBe(42n);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://hyperliquid.example/evm");
  });

  it("does not poll Zcash when no browser-safe RPC is configured", async () => {
    const fetchMock = mockRpc();
    const result = await fetchChainBalance(
      binding(3, {
        chain: "zcash_transparent",
        zcash_t_addr_testnet: "tm9iMLAuYMzJ4PiuGGtYwXKz9LqWYBS65vK",
      }),
      {
        solanaConnection: {} as Connection,
        evmRpcUrl: "https://ethereum.example/rpc",
        hyperliquidRpcUrl: "https://hyperliquid.example/evm",
        zcashRpcUrl: "",
      },
    );

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
