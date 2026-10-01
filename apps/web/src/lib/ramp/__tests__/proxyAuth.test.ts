import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
let POST: typeof import("@/app/api/ramp/[...path]/route").POST;
beforeEach(async () => {
  // Configure the mocked service before evaluating module-level production guards.
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("RAMP_API_URL", "https://settlement.test");
  vi.stubEnv("NEXT_PUBLIC_RAMP_API_URL", undefined);
  ({ POST } = await import("@/app/api/ramp/[...path]/route"));
});

const context = { params: Promise.resolve({ path: ["v1", "ramp", "intents"] }) };
function request(headers: Record<string, string> = {}, body = "{}") {
  return new NextRequest("https://clearsig.test/api/ramp/v1/ramp/intents", {
    method: "POST", body,
    headers: { host: "clearsig.test", origin: "https://clearsig.test", "content-type": "application/json", ...headers },
  });
}
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("ramp authenticated proxy", () => {
  it("forwards bearer and wallet proof context but drops caller-selected identity and cookies", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, data: {} }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request({
      authorization: "Bearer signed.dynamic.session", "x-wallet-address": "wallet-address",
      "x-user-id": "caller-selected-user", "idempotency-key": "stable-key", cookie: "session=do-not-forward",
    }), context);
    const init = fetch.mock.lastCall?.[1];
    expect(init.headers.get("authorization")).toBe("Bearer signed.dynamic.session");
    expect(init.headers.get("x-wallet-address")).toBe("wallet-address");
    expect(init.headers.get("idempotency-key")).toBe("stable-key");
    expect(init.headers.has("x-user-id")).toBe(false);
    expect(init.headers.has("cookie")).toBe(false);
    expect(init.redirect).toBe("manual");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("preserves settlement authentication failures and never upgrades x-user-id into a session", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: false, error: "Invalid session" }, { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request({ "x-user-id": "forged" }), context);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: "Invalid session" });
    expect(fetch.mock.lastCall?.[1].headers.has("authorization")).toBe(false);
    expect(fetch.mock.lastCall?.[1].headers.has("x-user-id")).toBe(false);
  });

  it("rejects an oversized streaming body before forwarding credentials upstream", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await POST(request({ authorization: "Bearer token" }, "x".repeat(64 * 1024 + 1)), context);
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects cross-origin requests before forwarding credentials", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await POST(request({ origin: "https://attacker.test", authorization: "Bearer token" }), context)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
