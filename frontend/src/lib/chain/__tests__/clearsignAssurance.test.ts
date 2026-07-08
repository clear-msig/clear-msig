import { describe, expect, it } from "vitest";
import {
  CLEAR_SIGNED_CHAIN_ASSURANCES,
  clearSignedChainAssurance,
  clearSignedChainAssuranceByKind,
} from "@/lib/chain/clearsignAssurance";
import { baseChainSendStatus } from "@/lib/chain/send-support";

describe("cross-chain send assurances", () => {
  it("covers ETH, BTC, ZEC, and Hyperliquid as readable legacy paths pending typed executors", () => {
    expect(CLEAR_SIGNED_CHAIN_ASSURANCES.map((item) => item.key)).toEqual([
      "eth",
      "btc",
      "zec",
      "hyperliquid",
    ]);

    for (const item of CLEAR_SIGNED_CHAIN_ASSURANCES) {
      expect(baseChainSendStatus(item.chainKind)).toBe("ready");
      expect(item.status).toBe("legacy_custom_pending_typed_executor");
      expect(item.intentFile).toMatch(/^examples\/intents\/.+\.json$/);
      expect(item.signPreview).toBe(true);
      expect(item.approvalGate).toBe("wallet_proposal");
      expect(item.executeMode).toBe("execute_then_broadcast");
      expect(item.primarySafetyCheck.length).toBeGreaterThan(10);
    }
  });

  it("looks up assurances by route key and chain kind", () => {
    expect(clearSignedChainAssurance("eth")).toMatchObject({
      surfaceId: "eth-send",
      status: "legacy_custom_pending_typed_executor",
      chainKind: 1,
      ticker: "ETH",
      sendRoute: "/send/eth",
    });
    expect(clearSignedChainAssuranceByKind(2)?.ticker).toBe("BTC");
    expect(clearSignedChainAssuranceByKind(3)?.ticker).toBe("ZEC");
    expect(clearSignedChainAssuranceByKind(5)?.ticker).toBe("HYPE");
    expect(clearSignedChainAssuranceByKind(99)).toBeNull();
  });

  it("pins the network-specific safety checks testers care about", () => {
    expect(clearSignedChainAssurance("btc").primarySafetyCheck).toContain(
      "change output",
    );
    expect(clearSignedChainAssurance("zec").primarySafetyCheck).toContain(
      "transparent address",
    );
    expect(clearSignedChainAssurance("hyperliquid").broadcastNetwork).toContain(
      "Hyperliquid",
    );
  });
});
