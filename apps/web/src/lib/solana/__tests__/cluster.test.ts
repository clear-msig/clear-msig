import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connection } from "@solana/web3.js";
import { createReadFallbackConnection } from "../cluster";
function connection(genesis = "network-a") {
  const mock = { getGenesisHash: vi.fn().mockResolvedValue(genesis), getBalance: vi.fn().mockResolvedValue(123),
    onAccountChange: vi.fn().mockReturnValue(7), sendRawTransaction: vi.fn().mockResolvedValue("tx"), rpcEndpoint: "https://rpc.example/secret" };
  return { mock, value: mock as unknown as Connection };
}
afterEach(() => vi.restoreAllMocks());
describe("same-network read fallback", () => {
  it("preserves synchronous subscription IDs", () => {
    const primary = connection(), fallback = connection();
    const combined = createReadFallbackConnection(primary.value, fallback.value);
    expect(combined.onAccountChange({} as never, () => {})).toBe(7);
    expect(primary.mock.getGenesisHash).not.toHaveBeenCalled();
  });
  it("never retries a failed transaction submission", async () => {
    const primary = connection(), fallback = connection();
    const error = new Error("fetch failed after broadcast");
    primary.mock.sendRawTransaction.mockRejectedValue(error);
    await expect(createReadFallbackConnection(primary.value, fallback.value).sendRawTransaction(new Uint8Array())).rejects.toBe(error);
    expect(fallback.mock.sendRawTransaction).not.toHaveBeenCalled();
  });
  it("verifies same-network fallback and avoids leaking endpoint credentials", async () => {
    const primary = connection(), fallback = connection();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    primary.mock.getBalance.mockRejectedValue(new Error("fetch failed"));
    const combined = createReadFallbackConnection(primary.value, fallback.value);
    expect(await combined.getBalance({} as never)).toBe(123);
    expect(await combined.getBalance({} as never)).toBe(123);
    expect(primary.mock.getBalance).toHaveBeenCalledOnce();
    expect(fallback.mock.getGenesisHash).toHaveBeenCalledOnce();
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret");
  });
  it("refuses cross-network failover", async () => {
    const primary = connection("mainnet"), fallback = connection("devnet");
    primary.mock.getBalance.mockRejectedValue(new Error("fetch failed"));
    await expect(createReadFallbackConnection(primary.value, fallback.value).getBalance({} as never)).rejects.toThrow("does not match");
    expect(fallback.mock.getBalance).not.toHaveBeenCalled();
  });
  it("requires an observed or configured identity when primary is down at startup", async () => {
    const primary = connection(), fallback = connection();
    primary.mock.getGenesisHash.mockRejectedValue(new Error("fetch failed"));
    await expect(createReadFallbackConnection(primary.value, fallback.value).getBalance({} as never)).rejects.toThrow("Cannot verify");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await createReadFallbackConnection(primary.value, fallback.value, "network-a").getBalance({} as never)).toBe(123);
  });
  it("refuses a misconfigured primary identity before account reads", async () => {
    const primary = connection("mainnet"), fallback = connection("devnet");
    await expect(createReadFallbackConnection(primary.value, fallback.value, "devnet").getBalance({} as never)).rejects.toThrow("does not match");
    expect(primary.mock.getBalance).not.toHaveBeenCalled();
    expect(fallback.mock.getBalance).not.toHaveBeenCalled();
  });
  it("does not reinterpret caller cancellation or program errors as transport failure", async () => {
    const primary = connection(), fallback = connection();
    for (const error of [new DOMException("aborted", "AbortError"), new Error("invalid account")]) {
      primary.mock.getBalance.mockRejectedValue(error);
      await expect(createReadFallbackConnection(primary.value, fallback.value).getBalance({} as never)).rejects.toBe(error);
    }
    expect(fallback.mock.getBalance).not.toHaveBeenCalled();
  });
});
