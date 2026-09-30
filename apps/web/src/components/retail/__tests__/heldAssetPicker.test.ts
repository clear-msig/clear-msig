import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HeldAssetPicker } from "../HeldAssetPicker";

vi.mock("@/lib/wallet", () => ({ useConnection: () => ({ connection: {} }) }));
vi.mock("@/lib/hooks/useSendChains", () => ({
  useSendChains: () => ({ options: [
    { chain: { kind: 0 }, address: "solana-vault" },
    { chain: { kind: 1 }, address: "evm-vault" },
  ] }),
}));
vi.mock("@/lib/chain/erc20", () => ({
  fetchErc20Holdings: vi.fn(),
  tokenAmountToString: () => "1",
}));
vi.mock("@/lib/chain/solanaTokens", () => ({ fetchSolanaTokenHoldings: vi.fn() }));
// React Query intentionally returns cached data even for disabled observers.
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === "solana-token-holdings"
      ? [{ tokenAccount: "spl-account", symbol: "SPL-ONLY", rawBalance: 1n, decimals: 0 }]
      : [{ contractAddress: "erc20-contract", symbol: "ERC20-ONLY", rawBalance: 1n, decimals: 0 }],
  }),
}));

describe("held assets network selection", () => {
  it("does not show cached Ethereum holdings on Solana", () => {
    const markup = renderToStaticMarkup(createElement(HeldAssetPicker, { walletName: "treasury", activeKind: 0 }));
    expect(markup).toContain("SPL-ONLY");
    expect(markup).not.toContain("ERC20-ONLY");
  });

  it.each([1, 4])("does not show cached Solana holdings on EVM chain kind %s", (activeKind) => {
    const markup = renderToStaticMarkup(createElement(HeldAssetPicker, { walletName: "treasury", activeKind }));
    expect(markup).toContain("ERC20-ONLY");
    expect(markup).not.toContain("SPL-ONLY");
  });

  it.each([null, 2, 3, 5])("hides unrelated holdings on chain kind %s", (activeKind) => {
    expect(renderToStaticMarkup(createElement(HeldAssetPicker, { walletName: "treasury", activeKind }))).toBe("");
  });
});
