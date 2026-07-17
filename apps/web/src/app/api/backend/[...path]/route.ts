import { NextRequest, NextResponse } from "next/server";
import { assertSameOrigin } from "@/lib/api/guard";
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
  const target = new URL(
    `/${path.map((part) => encodeURIComponent(part)).join("/")}`,
    appConfig.backendApiUrl,
  );
  target.search = request.nextUrl.search;

  try {
    const contentType = request.headers.get("content-type");
    const body = request.method === "GET" ? undefined : await request.text();
    const response = await fetch(target, {
      method: request.method,
      headers: {
        accept: request.headers.get("accept") ?? "application/json",
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body,
      cache: "no-store",
    });

    const headers = new Headers();
    const responseType = response.headers.get("content-type");
    const requestId = response.headers.get("x-request-id");
    if (responseType) headers.set("Content-Type", responseType);
    if (requestId) headers.set("x-request-id", requestId);

    return new NextResponse(await response.arrayBuffer(), {
      status: response.status,
      headers,
    });
  } catch (error) {
    console.error("[api/backend] proxy failed", error);
    if (error instanceof DOMException && error.name === "AbortError") {
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
