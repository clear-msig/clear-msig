import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { messageFlavorForSigner } from "@/lib/hooks/signFlavor";

describe("messageFlavorForSigner", () => {
  const ledger = new PublicKey("11111111111111111111111111111112");
  const software = new PublicKey("11111111111111111111111111111113");

  it("uses offchain bytes when the actual signer is the Ledger", () => {
    expect(
      messageFlavorForSigner({
        preferSigner: ledger,
        isLedger: true,
        ledgerPublicKey: ledger,
      }),
    ).toBe("offchain_v1");
  });

  it("uses plain bytes when a Ledger is connected but a software signer is selected", () => {
    expect(
      messageFlavorForSigner({
        preferSigner: software,
        isLedger: true,
        ledgerPublicKey: ledger,
      }),
    ).toBe("plain_v2");
  });

  it("falls back to the active signer when no signer preference is supplied", () => {
    expect(
      messageFlavorForSigner({
        isLedger: true,
        ledgerPublicKey: ledger,
      }),
    ).toBe("offchain_v1");
    expect(
      messageFlavorForSigner({
        isLedger: false,
        ledgerPublicKey: null,
      }),
    ).toBe("plain_v2");
  });
});
