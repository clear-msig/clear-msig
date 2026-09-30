import { NextResponse } from "next/server";

export type BoundedBody =
  | { ok: true; text: string }
  | { ok: false; response: NextResponse };

/** Enforce byte limits while streaming, including requests without Content-Length. */
export async function readBoundedBody(
  request: Request,
  maxBytes: number,
  tooLargeMessage = "Request body is too large.",
): Promise<BoundedBody> {
  const tooLarge = (): BoundedBody => ({
    ok: false,
    response: NextResponse.json({ error: tooLargeMessage }, { status: 413 }),
  });
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return tooLarge();
  if (!request.body) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      bytes += result.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return tooLarge();
      }
      text += decoder.decode(result.value, { stream: true });
    }
    return { ok: true, text: text + decoder.decode() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Could not read request body." }, { status: 400 }),
    };
  } finally {
    reader.releaseLock();
  }
}
