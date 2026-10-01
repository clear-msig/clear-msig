import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const context = { params: Promise.resolve({ path: ["v1", "ramp", "intents"] }) };
function request(origin = "https://clearsig.test", body = "{}") {
  return new NextRequest("https://clearsig.test/api/ramp/v1/ramp/intents", {
    method: "POST", body,
    headers: { host: "clearsig.test", origin, authorization: "Bearer synthetic-session" },
  });
}
async function loadRoute(options: { nodeEnv?: string; vercelEnv?: string; privateUrl?: string; publicUrl?: string } = {}) {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", options.nodeEnv ?? "production");
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("VERCEL_ENV", options.vercelEnv ?? "preview");
  vi.stubEnv("RAMP_API_URL", options.privateUrl);
  vi.stubEnv("NEXT_PUBLIC_RAMP_API_URL", options.publicUrl);
  return import("@/app/api/ramp/[...path]/route");
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ramp configuration under production builds", () => {
  it.each(["preview", "production", ""])('fails closed without a service target (VERCEL_ENV=%s)', async (vercelEnv) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const route = await loadRoute({ vercelEnv });
    // Missing configuration takes precedence even for an oversized body.
    for (const body of ["{}", "x".repeat(64 * 1024 + 1)]) {
      const response = await route.POST(request(undefined, body), context);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: "Bank transfer service is not configured." });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("checks origin before missing production configuration", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const route = await loadRoute();
    expect((await route.POST(request("https://attacker.test"), context)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { privateUrl: "https://private-settlement.test", publicUrl: "https://public-settlement.test", expected: "https://private-settlement.test" },
    { publicUrl: "https://public-settlement.test", expected: "https://public-settlement.test" },
    { nodeEnv: "development", expected: "http://127.0.0.1:8088" },
  ])("uses only the configured precedence or explicit development fallback: $expected", async ({ expected, ...options }) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const route = await loadRoute(options);
    expect((await route.POST(request(), context)).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0].origin).toBe(expected);
    expect(fetch.mock.calls[0][1].redirect).toBe("manual");
  });
});
