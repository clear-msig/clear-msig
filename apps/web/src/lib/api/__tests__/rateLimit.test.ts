import { afterEach, describe, expect, it, vi } from "vitest";

async function limiter() {
  vi.resetModules();
  const { checkRateLimit } = await import("../rateLimit");
  return checkRateLimit;
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("bounded server rate limiter", () => {
  it("enforces refill without resetting exhausted active buckets", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const check = await limiter();
    const limit = { capacity: 1, refillPerSec: 1 };
    expect(await check("test", "member", limit)).toBeNull();
    expect((await check("test", "member", limit))?.status).toBe(429);
    vi.setSystemTime(1000);
    expect(await check("test", "member", limit)).toBeNull();
  });
  it("caps key cardinality and retains existing exhausted limits", async () => {
    vi.useFakeTimers(); vi.setSystemTime(0);
    const check = await limiter();
    const limit = { capacity: 1, refillPerSec: 1 / 60 };
    for (let i = 0; i < 10_000; i++) expect(await check("test", String(i), limit)).toBeNull();
    expect((await check("test", "overflow", limit))?.status).toBe(429);
    expect((await check("test", "0", limit))?.status).toBe(429);
    vi.setSystemTime(300001);
    expect(await check("test", "fresh", limit)).toBeNull();
  });
  it("rejects oversized keys before network activity", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const check = await limiter();
    expect((await check("test", "x".repeat(513), { capacity: 1, refillPerSec: 1 }))?.status).toBe(429);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([0, -1, NaN, Infinity])("rejects invalid refill %s", async (refillPerSec) => {
    const check = await limiter();
    await expect(check("test", "key", { capacity: 1, refillPerSec })).rejects.toThrow("Invalid rate-limit");
  });
});
