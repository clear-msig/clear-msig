import { afterEach, describe, expect, it, vi } from "vitest";
import { createVenueRedisCommand } from "../serverVenueRedis";

afterEach(() => vi.unstubAllGlobals());
describe("explicit durable Redis HTTP transport", () => {
  it.each([
    "http://storage.example",
    "https://user:password@storage.example",
    "https://storage.example?token=value",
    "https://storage.example#fragment",
  ])("rejects unsafe endpoint %s", (url) => {
    expect(() => createVenueRedisCommand(url, "test-credential")).toThrow(
      "trusted HTTPS",
    );
  });
  it("uses bounded server-only authenticated POST without redirects or caching", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(JSON.stringify({ result: "ok" })),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(
      createVenueRedisCommand(
        "https://storage.example",
        "test-credential",
      )(["PING"]),
    ).resolves.toBe("ok");
    expect(fetch.mock.calls[0][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      cache: "no-store",
      body: '["PING"]',
      headers: { authorization: "Bearer test-credential" },
    });
  });
  it("bounds storage responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(65537))),
    );
    await expect(
      createVenueRedisCommand(
        "https://storage.example",
        "test-credential",
      )(["PING"]),
    ).rejects.toThrow("exceeds");
  });
  it("does not expose storage error details or credentials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "test-secret detail" })),
      ),
    );
    await expect(
      createVenueRedisCommand(
        "https://storage.example",
        "test-credential",
      )(["PING"]),
    ).rejects.toThrow(/^Durable venue storage rejected the operation\.$/);
  });
});
