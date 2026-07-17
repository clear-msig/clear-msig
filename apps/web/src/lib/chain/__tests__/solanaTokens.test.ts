import { describe, expect, it } from "vitest";
import { solanaTokenMetadata } from "@/lib/chain/solanaTokens";

describe("Solana token metadata", () => {
  it("labels known stablecoin mints with their fiat symbols", () => {
    expect(
      solanaTokenMetadata("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
    ).toMatchObject({ symbol: "USDC", name: "USD Coin" });
    expect(
      solanaTokenMetadata("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"),
    ).toMatchObject({ symbol: "USDT", name: "Tether USD" });
  });

  it("keeps unknown held tokens identifiable without inventing a ticker", () => {
    expect(
      solanaTokenMetadata("11111111111111111111111111111111"),
    ).toEqual({ symbol: "1111...1111", name: "Solana token" });
  });
});
