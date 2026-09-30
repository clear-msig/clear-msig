import type { Connection } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { confirmSuccessfulTransaction } from "../confirmTransaction";

const strategy = { signature: "test-signature", blockhash: "test-blockhash", lastValidBlockHeight: 100 };
describe("recovery transaction confirmation", () => {
  it("requires an explicitly successful confirmed result", async () => {
    const confirmTransaction = vi.fn().mockResolvedValue({ context: { slot: 1 }, value: { err: null } });
    await confirmSuccessfulTransaction({ confirmTransaction } as unknown as Connection, strategy);
    expect(confirmTransaction).toHaveBeenCalledExactlyOnceWith(strategy, "confirmed");
  });

  it("rejects onchain instruction failures even when the RPC call resolves", async () => {
    const connection = { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: { InstructionError: [0, { Custom: 42 }] } } }) } as unknown as Connection;
    await expect(confirmSuccessfulTransaction(connection, strategy)).rejects.toThrow("failed on chain");
  });

  it.each([undefined, {}, { value: {} }])("rejects an unverified RPC status %#", async (response) => {
    const connection = { confirmTransaction: vi.fn().mockResolvedValue(response) } as unknown as Connection;
    await expect(confirmSuccessfulTransaction(connection, strategy)).rejects.toThrow("no verified confirmation status");
  });

  it("propagates unavailable confirmation instead of reporting success", async () => {
    const error = new Error("RPC unavailable");
    const connection = { confirmTransaction: vi.fn().mockRejectedValue(error) } as unknown as Connection;
    await expect(confirmSuccessfulTransaction(connection, strategy)).rejects.toBe(error);
  });
});
