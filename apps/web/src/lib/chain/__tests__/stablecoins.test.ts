import { describe, expect, it } from "vitest";

import {
  ETHEREUM_SEPOLIA_USDC,
  STABLECOIN_DEPLOYMENTS,
  stablecoinsForNetwork,
} from "@/lib/chain/stablecoins";

describe("stablecoin deployment registry", () => {
  it("enables only the issuer-verified stablecoin with a typed send path", () => {
    expect(ETHEREUM_SEPOLIA_USDC).toMatchObject({
      symbol: "USDC",
      network: "ethereum-sepolia",
      address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
      decimals: 6,
      issuer: "Circle",
      typedSendAvailable: true,
    });
  });

  it("does not claim typed support for Solana or HyperEVM before executors exist", () => {
    expect(stablecoinsForNetwork("solana-devnet")[0]?.typedSendAvailable).toBe(false);
    expect(stablecoinsForNetwork("hyperevm-testnet")[0]?.typedSendAvailable).toBe(false);
  });

  it("does not invent an issuer-unpublished USDT testnet deployment", () => {
    expect(STABLECOIN_DEPLOYMENTS.some((entry) => entry.symbol === "USDT")).toBe(false);
  });
});
