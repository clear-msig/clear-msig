import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import * as backend from "@/app/api/backend/[...path]/route";
import * as ramp from "@/app/api/ramp/[...path]/route";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/config", () => ({ appConfig: { backendApiUrl: "https://backend.test" } }));

afterEach(() => vi.unstubAllGlobals());

for (const [name, route] of [["backend", backend], ["ramp", ramp]] as const) {
  describe(`${name} proxy`, () => {
    const context = { params: Promise.resolve({ path: ["v1", "test"] }) };
    const request = (signal?: AbortSignal) => new NextRequest(`https://clearsig.test/api/${name}/v1/test`, {
      method: "POST", headers: { host: "clearsig.test", origin: "https://clearsig.test", "Content-Type": "application/json" },
      body: JSON.stringify({ value: 1 }), signal,
    });

    it("forwards JSON and request IDs with a bounded cancellable fetch", async () => {
      const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }, { headers: { "x-request-id": "upstream" } }));
      vi.stubGlobal("fetch", fetch);
      const response = await route.POST(request(), context);
      expect(response.status).toBe(200);
      expect(response.headers.get("x-request-id")).toBe("upstream");
      expect(await response.json()).toEqual({ ok: true });
      expect(fetch).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({
        method: "POST", body: '{"value":1}', signal: expect.any(AbortSignal), cache: "no-store",
      }));
    });

    it.each([204, 205, 304])("preserves bodyless upstream status %i", async (status) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status })));
      const response = await route.POST(request(), context);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    });

    it("does not forward an already cancelled request", async () => {
      const fetch = vi.fn();
      vi.stubGlobal("fetch", fetch);
      const controller = new AbortController();
      controller.abort();
      expect((await route.POST(request(controller.signal), context)).status).toBe(499);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("propagates cancellation to the upstream request", async () => {
      const controller = new AbortController();
      vi.stubGlobal("fetch", vi.fn((_url: URL, init: RequestInit) => {
        controller.abort();
        return Promise.reject(init.signal?.reason);
      }));
      expect((await route.POST(request(controller.signal), context)).status).toBe(499);
    });

    it("returns an explicit timeout without encouraging duplicate submissions", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new DOMException("Timeout", "TimeoutError")));
      const response = await route.POST(request(), context);
      expect(response.status).toBe(504);
      expect((await response.json()).error).toMatch(/before retrying/i);
    });
  });
}
