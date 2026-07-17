import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/guard";

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
  const target = new URL(
    `/${path.map((part) => encodeURIComponent(part)).join("/")}`,
    DEFAULT_RAMP_API_URL,
  );
  target.search = request.nextUrl.search;

  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  const accept = request.headers.get("accept");
  const userId = request.headers.get("x-user-id");
  const idempotencyKey = request.headers.get("idempotency-key");
  if (contentType) headers.set("Content-Type", contentType);
  if (accept) headers.set("Accept", accept);
  if (userId) headers.set("x-user-id", userId);
  if (idempotencyKey) headers.set("idempotency-key", idempotencyKey);

  try {
    const body = request.method === "GET" ? undefined : await request.text();
    const response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    const responseHeaders = new Headers();
    const responseType = response.headers.get("content-type");
    const requestId = response.headers.get("x-request-id");
    if (responseType) responseHeaders.set("Content-Type", responseType);
    if (requestId) responseHeaders.set("x-request-id", requestId);

    return new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("[api/ramp] proxy failed", error);
    return NextResponse.json(
      { error: "Bank transfer service is unavailable." },
      { status: 502 },
    );
  }
}
