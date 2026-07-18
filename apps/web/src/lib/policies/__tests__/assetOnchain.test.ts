import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import {
  encodeTypedSplAssetPolicy,
  SOLANA_DEVNET_USDC_MINT,
} from "@/lib/policies/assetOnchain";

describe("CSP2 asset policy codec", () => {
  it("binds the USDC mint, decimals, recipient, and amount units", () => {
    const recipient = PublicKey.unique().toBase58();
    const encoded = encodeTypedSplAssetPolicy({
      evaluation: null,
      rule: null,
      conditions: [{ kind: "amount", ticker: "USDC", maxDisplay: "12.5" }],
      extraApprovers: [],
      extraCooldownSeconds: 0,
      recipientGuard: { mode: "allowlist", addresses: [recipient] },
      memberAllowances: [],
      allowedTimeWindow: null,
      onchainLimits: {
        velocityCapDisplay: "50",
        velocityWindowSeconds: 86_400,
        maxSendCount: 3,
        countWindowSeconds: 86_400,
      },
    }, {
      mint: SOLANA_DEVNET_USDC_MINT,
      decimals: 6,
      ticker: "USDC",
    });

    expect(encoded.hex.startsWith("435350320106")).toBe(true);
    expect(encoded.bytes.slice(6, 38)).toEqual(new PublicKey(SOLANA_DEVNET_USDC_MINT).toBytes());
    expect(encoded.bytes.slice(38, 42)).toEqual(new TextEncoder().encode("CSP1"));
    expect(encoded.hex).toContain(Buffer.from(new PublicKey(recipient).toBytes()).toString("hex"));
    expect(encoded.hex).toContain("20bcbe0000000000");
  });
});
