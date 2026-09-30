import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/guard";
import { readBoundedBody } from "@/lib/api/body";
import { authorizeBackendProxy } from "@/lib/api/backendAuthorization";
import { appConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ALLOWED_METHODS = new Set(["GET", "POST"]);

interface RouteContext {
  params: Promise<{
    path?: string[];
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxyBackendRequest(request, context);
}

async function proxyBackendRequest(request: NextRequest, context: RouteContext) {
  const blocked = assertSameOrigin(request, {
    allowMissingOrigin: request.method === "GET",
  });
  if (blocked) return blocked;

  if (!ALLOWED_METHODS.has(request.method)) {
    return NextResponse.json({ error: "Method not allowed." }, { status: 405 });
  }

  const path = (await context.params).path ?? [];
  try {
    const target = new URL(
      `/${path.map((part) => encodeURIComponent(part)).join("/")}`,
      appConfig.backendApiUrl,
    );
    target.search = request.nextUrl.search;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55_000)]);
    signal.throwIfAborted();
    const contentType = request.headers.get("content-type");
    const read = request.method === "GET" ? null : await readBoundedBody(request, 2 * 1024 * 1024);
    if (read && !read.ok) return read.response;
    const body = read?.ok ? read.text : undefined;
    const authorization = await authorizeBackendProxy(request, path, body);
    if (!authorization.ok) return authorization.response;
    const response = await fetch(target, {
      method: request.method,
      headers: {
        accept: request.headers.get("accept") ?? "application/json",
        ...authorization.headers,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body,
      cache: "no-store",
      signal,
    });

    const headers = new Headers({ "Cache-Control": "private, no-store" });
    const responseType = response.headers.get("content-type");
    const requestId = response.headers.get("x-request-id");
    if (responseType) headers.set("Content-Type", responseType);
    if (requestId) headers.set("x-request-id", requestId);

    const responseBody = response.status === 204 || response.status === 205 || response.status === 304
      ? null
      : await response.arrayBuffer();
    return new NextResponse(responseBody, {
      status: response.status,
      headers,
    });
  } catch (error) {
    if (request.signal.aborted) {
      return NextResponse.json({ error: "Request cancelled." }, { status: 499 });
    }
    console.error("[api/backend] proxy failed", error);
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      return NextResponse.json(
        {
          error:
            "Backend request timed out. The operation may still finish on-chain; refresh your wallets before retrying.",
          kind: "proxy_timeout",
        },
        { status: 504 },
      );
    }
    return NextResponse.json(
      { error: "Backend is unavailable." },
      { status: 502 },
    );
  }
}
