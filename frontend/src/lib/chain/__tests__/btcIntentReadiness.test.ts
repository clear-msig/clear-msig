import { describe, expect, it } from "vitest";
import { IntentType } from "@/lib/msig";
import {
  BTC_CHAIN_KIND,
  bitcoinSendReady,
  selectBitcoinSendIntent,
} from "@/lib/chain/btcIntentReadiness";

function btcIntent(params: number, intentIndex = params) {
  return {
    intentIndex,
    intentType: IntentType.Custom,
    chainKind: BTC_CHAIN_KIND,
    params: Array.from({ length: params }, (_, index) => index),
  };
}

describe("Bitcoin send intent readiness", () => {
  it("treats an old 6-param BTC intent as setup required", () => {
    const intent = selectBitcoinSendIntent([btcIntent(6)]);

    expect(intent?.intentIndex).toBe(6);
    expect(bitcoinSendReady(intent)).toBe(false);
  });

  it("treats a new 8-param BTC intent as ready", () => {
    const intent = selectBitcoinSendIntent([btcIntent(8)]);

    expect(intent?.intentIndex).toBe(8);
    expect(bitcoinSendReady(intent)).toBe(true);
  });

  it("picks the 8-param BTC intent when old and new both exist", () => {
    const intent = selectBitcoinSendIntent([btcIntent(6), btcIntent(8)]);

    expect(intent?.intentIndex).toBe(8);
    expect(bitcoinSendReady(intent)).toBe(true);
  });

  it("treats missing BTC intent as setup required", () => {
    const intent = selectBitcoinSendIntent([
      {
        intentType: IntentType.Custom,
        chainKind: 1,
        params: Array.from({ length: 8 }, (_, index) => index),
      },
    ]);

    expect(intent).toBeNull();
    expect(bitcoinSendReady(intent)).toBe(false);
  });
});
