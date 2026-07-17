import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { parseAgentRiskLedger } from "@/lib/agents/agentRiskLedger";
import { fromHex } from "@/lib/msig";

describe("agent risk ledger parser", () => {
  it("reads sequence and u128 accounting from the program layout", () => {
    const wallet = new PublicKey(new Uint8Array(32).fill(7));
    const pda = new PublicKey(new Uint8Array(32).fill(8));
    const sessionHash = "11".repeat(32);
    const data = new Uint8Array(187);
    data[0] = 10;
    data.set(wallet.toBytes(), 1);
    data.set(fromHex(sessionHash), 33);
    data.set(fromHex("22".repeat(32)), 65);
    writeU128(data, 97, 500_000_000n);
    writeU128(data, 113, 20_000_000n);
    writeU128(data, 129, 250_000_000n);
    new DataView(data.buffer).setBigUint64(145, 4n, true);
    data.set(fromHex("33".repeat(32)), 153);
    data[185] = 1;

    const parsed = parseAgentRiskLedger(data, pda, wallet, sessionHash);
    expect(parsed.openNotionalRaw).toBe(250_000_000n);
    expect(parsed.realizedLossRaw).toBe(20_000_000n);
    expect(parsed.nextSettlementSequence).toBe(4n);
    expect(parsed.oraclePolicyHash).toBe("22".repeat(32));
    expect(parsed.status).toBe("active");
  });

  it("rejects a ledger from another session", () => {
    const wallet = new PublicKey(new Uint8Array(32).fill(7));
    const data = new Uint8Array(187);
    data[0] = 10;
    data.set(wallet.toBytes(), 1);
    data.set(fromHex("11".repeat(32)), 33);
    expect(() => parseAgentRiskLedger(data, wallet, wallet, "22".repeat(32))).toThrow(/identity/);
  });
});

function writeU128(data: Uint8Array, offset: number, value: bigint) {
  const view = new DataView(data.buffer);
  view.setBigUint64(offset, value & ((1n << 64n) - 1n), true);
  view.setBigUint64(offset + 8, value >> 64n, true);
}
