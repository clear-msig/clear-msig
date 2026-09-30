import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, BackendApiError, BackendTimeoutError } from "../client";

vi.mock("@/lib/config", () => ({ appConfig: { backendApiUrl: "https://backend.test" } }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function pendingFetch() {
  return vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const signal = init.signal!;
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
}

describe("backend request cancellation", () => {
  it("never submits when the caller already cancelled", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const reason = new Error("Workflow closed");
    controller.abort(reason);
    await expect(apiRequest("/proposals", "POST", {}, { signal: controller.signal })).rejects.toBe(reason);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves caller cancellation and cleans the timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", pendingFetch());
    const controller = new AbortController();
    const request = apiRequest("/proposals", "POST", {}, { signal: controller.signal });
    const rejected = expect(request).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports actual timeouts distinctly", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", pendingFetch());
    const request = apiRequest("/wallet", "GET", undefined, { timeoutMs: 20 });
    const rejected = expect(request).rejects.toBeInstanceOf(BackendTimeoutError);
    await vi.advanceTimersByTimeAsync(20);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not swallow cancellation while reading the response body", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => {
        controller.abort();
        throw controller.signal.reason;
      },
    }));
    await expect(apiRequest("/prepare", "POST", {}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not return success if cancellation wins a response parsing race", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers(),
      json: async () => { controller.abort(); return { ok: true }; },
    }));
    await expect(apiRequest("/prepare", "POST", {}, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps opaque HTTP errors and request IDs actionable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", {
      status: 502, headers: { "x-request-id": "test-request" },
    })));
    await expect(apiRequest("/wallet", "GET")).rejects.toMatchObject({
      name: BackendApiError.name,
      message: "Request failed with status 502 [request_id=test-request]",
      requestId: "test-request",
    });
  });

  it.each([false, 0, "", null])("preserves the JSON body %j", async (body) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await apiRequest("/value", "POST", body);
    expect(fetch).toHaveBeenCalledWith("https://backend.test/value", expect.objectContaining({ body: JSON.stringify(body) }));
  });
});
