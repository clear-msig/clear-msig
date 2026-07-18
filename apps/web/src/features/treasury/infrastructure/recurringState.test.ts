import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { parseRecurringScheduleAccount } from "./recurringState";

function key(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

describe("recurring onchain state", () => {
  it("recovers the token execution accounts and raw amount", () => {
    const data = new Uint8Array(961);
    data[0] = 13;
    data.set(key(2), 33); // intent
    data.set(key(3), 97); // recipient owner
    data.set(key(4), 161); // mint
    data.set(key(5), 193); // source
    data.set(key(6), 225); // destination
    const view = new DataView(data.buffer);
    view.setBigUint64(289, 1_250_000n, true);
    view.setUint32(297, 86_400, true);
    view.setBigInt64(301, 1_800_000_000n, true);
    view.setUint32(309, 11, true);
    view.setUint32(313, 1, true);
    data[959] = 1;

    expect(parseRecurringScheduleAccount("schedule", data)).toEqual({
      address: "schedule",
      intent: new PublicKey(key(2)).toBase58(),
      recipient: new PublicKey(key(3)).toBase58(),
      asset: "USDC",
      amountRaw: 1_250_000n,
      mint: new PublicKey(key(4)).toBase58(),
      sourceToken: new PublicKey(key(5)).toBase58(),
      destinationToken: new PublicKey(key(6)).toBase58(),
      intervalSeconds: 86_400,
      nextExecutionAt: 1_800_000_000,
      remainingPayments: 11,
      executedPayments: 1,
      status: "active",
      policyVersion: "CSP1",
    });
  });

  it("recognizes asset-scoped CSP2 token schedules", () => {
    const data = new Uint8Array(961);
    data[0] = 13;
    data.set(new TextEncoder().encode("CSP2"), 319);
    data[959] = 1;

    expect(parseRecurringScheduleAccount("schedule", data)?.policyVersion).toBe("CSP2");
  });
});
