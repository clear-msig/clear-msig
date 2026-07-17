import { describe, expect, it } from "vitest";

import {
  FULL_CLEARSIGN_PROFILE_ID,
  LEDGER_SOLANA_CLEARSIGN_PROFILE_ID,
  clearSignProfileForSigner,
  resolveClearSignDeviceProfile,
} from "@/lib/clearsign";

describe("ClearSign device profile registry", () => {
  it("fails closed to the full profile for unknown and old capabilities", () => {
    expect(
      clearSignProfileForSigner({ isLedger: false, ledgerAppVersion: null }).id,
    ).toBe(FULL_CLEARSIGN_PROFILE_ID);
    expect(
      clearSignProfileForSigner({
        isLedger: true,
        ledgerAppVersion: "1.13.9",
      }).id,
    ).toBe(FULL_CLEARSIGN_PROFILE_ID);
    expect(
      clearSignProfileForSigner({
        isLedger: true,
        ledgerAppVersion: "unknown",
      }).id,
    ).toBe(FULL_CLEARSIGN_PROFILE_ID);
  });

  it("selects compact only for an allowlisted Ledger Solana version", () => {
    const request = clearSignProfileForSigner({
      isLedger: true,
      ledgerAppVersion: "1.14.0",
    });

    expect(request.id).toBe(LEDGER_SOLANA_CLEARSIGN_PROFILE_ID);
    expect(resolveClearSignDeviceProfile(request)).toEqual({
      id: LEDGER_SOLANA_CLEARSIGN_PROFILE_ID,
      version: 1,
      mode: "compact",
      maxDocumentBytes: 1024,
    });
  });

  it("uses the full profile when another authorized key will sign", () => {
    const ledgerPublicKey = { toBase58: () => "ledger-key" };
    const embeddedSigner = { toBase58: () => "embedded-key" };

    expect(
      clearSignProfileForSigner(
        {
          isLedger: true,
          ledgerAppVersion: "1.14.0",
          ledgerPublicKey,
        },
        embeddedSigner,
      ).id,
    ).toBe(FULL_CLEARSIGN_PROFILE_ID);
  });
});
