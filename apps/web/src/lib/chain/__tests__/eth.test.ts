import { describe, expect, it } from "vitest";
import {
  blockscoutBaseFromRpc,
  ethToWei,
  isValidEvmAddress,
  weiToEth,
} from "@/lib/chain/eth";

describe("EVM send helpers", () => {
  it("validates EVM recipients without forcing checksum casing", () => {
    expect(isValidEvmAddress("0x000000000000000000000000000000000000dEaD")).toBe(
      true,
    );
    expect(isValidEvmAddress("0x000000000000000000000000000000000000dead")).toBe(
      true,
    );
    expect(isValidEvmAddress("0xnot-an-address")).toBe(false);
  });

  it("converts ETH and HYPE native amounts to exact wei", () => {
    expect(ethToWei("1")).toBe(1_000_000_000_000_000_000n);
    expect(ethToWei("0.000000000000000001")).toBe(1n);
    expect(ethToWei("2.5")).toBe(2_500_000_000_000_000_000n);
    expect(weiToEth(2_500_000_000_000_000_000n)).toBe("2.5");
  });

  it("keeps chain explorers network-specific for EVM sends", () => {
    expect(blockscoutBaseFromRpc("https://ethereum-sepolia-rpc.publicnode.com")).toBe(
      "https://eth-sepolia.blockscout.com",
    );
    expect(blockscoutBaseFromRpc("https://mainnet.optimism.io")).toBe(
      "https://optimism.blockscout.com",
    );
  });
});
