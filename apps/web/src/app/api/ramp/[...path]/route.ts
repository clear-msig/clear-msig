import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/guard";
import { readBoundedBody } from "@/lib/api/body";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_METHODS = new Set(["GET", "POST"]);
const RAMP_API_URL =
  process.env.RAMP_API_URL ?? process.env.NEXT_PUBLIC_RAMP_API_URL;
const DEFAULT_RAMP_API_URL =
  RAMP_API_URL ?? "http://127.0.0.1:8088";
const IS_PRODUCTION = process.env.NODE_ENV === "production";

interface RouteContext {
  params: Promise<{
    path?: string[];
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyRampRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyRampRequest(request, context);
}

async function proxyRampRequest(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request, {
    allowMissingOrigin: request.method === "GET",
  });
  if (blocked) return blocked;

  if (!ALLOWED_METHODS.has(request.method)) {
    return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
  }
  if (IS_PRODUCTION && !RAMP_API_URL) {
    return NextResponse.json(
      { error: "Bank transfer service is not configured." },
      { status: 503 },
    );
  }

  const path = (await context.params).path ?? [];
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const authorization = request.headers.get("authorization");
  const walletAddress = request.headers.get("x-wallet-address");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (contentType) headers.set("Content-Type", contentType);
  if (accept) headers.set("Accept", accept);
  // Forward the actual credential. The settlement service verifies it even for
  // direct callers; the proxy must never manufacture or trust a user ID.
  if (authorization) headers.set("Authorization", authorization);
  if (walletAddress) headers.set("x-wallet-address", walletAddress);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  try {
    const target = new URL(
      `/${path.map((part) => encodeURIComponent(part)).join("/")}`,
      DEFAULT_RAMP_API_URL,
    );
    target.search = request.nextUrl.search;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
    signal.throwIfAborted();
    let body: string | undefined;
    if (request.method !== "GET") {
      const bounded = await readBoundedBody(request, 64 * 1024);
      if (!bounded.ok) return bounded.response;
      body = bounded.text;
    }
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal,
    });

    const responseHeaders = new Headers({ "Cache-Control": "no-store" });
    const responseType = response.headers.get("content-type");
    const requestId = response.headers.get("x-request-id");
    if (responseType) responseHeaders.set("Content-Type", responseType);
    if (requestId) responseHeaders.set("x-request-id", requestId);

    const responseBody = response.status === 204 || response.status === 205 || response.status === 304
      ? null
      : await response.arrayBuffer();
    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request cancelled." }, { status: 499 });
    }
    console.error("[api/ramp] proxy failed", error);
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return NextResponse.json(
        { error: "Bank transfer service timed out. Check the transfer status before retrying." },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Bank transfer service is unavailable." },
      { status: 502 },
    );
  }
}
