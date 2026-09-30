import { describe, expect, it, vi } from "vitest";
import { readBoundedBody } from "../body";

function streamedRequest(chunks: Uint8Array[], headers?: HeadersInit, cancel = vi.fn()) {
  let index = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index === chunks.length) controller.close();
      else controller.enqueue(chunks[index++]);
    },
    cancel,
  });
  return new Request("https://clearsig.test/api/test", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit);
}

describe("bounded request bodies", () => {
  it("rejects an oversized declared body before consuming it", async () => {
    const request = streamedRequest([new Uint8Array(100)], { "content-length": "100" });
    const result = await readBoundedBody(request, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(413);
    expect(request.bodyUsed).toBe(false);
  });
  it("enforces actual streamed bytes even with missing or dishonest Content-Length", async () => {
    for (const headers of [undefined, { "content-length": "1" }]) {
      const cancel = vi.fn();
      const request = streamedRequest([new Uint8Array(6), new Uint8Array(6), new Uint8Array(6)], headers, cancel);
      const result = await readBoundedBody(request, 10, "Too big");
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.response.status).toBe(413);
        expect(await result.response.json()).toEqual({ error: "Too big" });
      }
      expect(cancel).toHaveBeenCalledOnce();
      expect(request.body?.locked).toBe(false);
    }
  });
  it("decodes multibyte UTF-8 correctly across chunks and counts bytes", async () => {
    const bytes = new TextEncoder().encode("a🙂b");
    const chunks = [bytes.slice(0, 3), bytes.slice(3)];
    expect(await readBoundedBody(streamedRequest(chunks), 6)).toEqual({ ok: true, text: "a🙂b" });
    expect((await readBoundedBody(streamedRequest(chunks), 5)).ok).toBe(false);
  });
  it("accepts an empty body", async () => {
    expect(await readBoundedBody(new Request("https://clearsig.test"), 10)).toEqual({ ok: true, text: "" });
  });
  it("returns a client error and releases failed streams", async () => {
    const request = new Request("https://clearsig.test", {
      method: "POST", duplex: "half",
      body: new ReadableStream({ start(controller) { controller.error(new Error("disconnected")); } }),
    } as RequestInit);
    const result = await readBoundedBody(request, 10);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.response.status).toBe(400);
    expect(request.body?.locked).toBe(false);
  });
});
