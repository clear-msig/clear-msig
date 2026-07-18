import { describe, expect, it } from "vitest";
import { recurringAmountToRaw, recurringEnvelope } from "./recurring";

describe("recurring schedule domain", () => {
  it("converts SOL and USDC without floating point arithmetic", () => {
    expect(recurringAmountToRaw("0.3", "SOL")).toBe(300_000_000);
    expect(recurringAmountToRaw("1.25", "USDC")).toBe(1_250_000);
    expect(() => recurringAmountToRaw("1.0000001", "USDC")).toThrow();
  });

  it("binds USDC mint and token accounts into the canonical payload", () => {
    const payload = recurringEnvelope({
      walletName: "Team treasury",
      scheduleId: "schedule-1",
      recipient: "11111111111111111111111111111111",
      amount: "1.25",
      asset: "USDC",
      mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
      sourceToken: "SourceToken11111111111111111111111111111",
      destinationToken: "Destination1111111111111111111111111111",
      intervalSeconds: 86_400,
      firstExecutionAt: 1_800_000_000,
      paymentCount: 12,
      status: "active",
    }).payload;
    expect(payload).toMatchObject({
      assetEncoding: "solana_pubkey",
      decimals: 6,
      displayAsset: "USDC",
      sourceToken: "SourceToken11111111111111111111111111111",
      destinationToken: "Destination1111111111111111111111111111",
    });
  });
});
