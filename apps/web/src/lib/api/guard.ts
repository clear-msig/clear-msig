// Server-side guards for /api/* routes.
//
// These endpoints are only ever called same-origin from the Clear
// frontend. Any request whose Origin does not match the request host
// (or that has no Origin/Referer header at all) is treated as a
// cross-origin or scripted attempt and rejected.
//
// This is CSRF defence-in-depth on top of the per-action signing
// model. Real protection against signed-payload abuse lives in the
// wallet popup; the guard here closes the trivial "POST it from
// elsewhere" hole and gives us a single chokepoint for rate
// limiting.

import { NextRequest, NextResponse } from "next/server";

export interface GuardOptions {
  /// When true, a missing Origin AND missing Referer is allowed.
  /// Use only for endpoints that legitimately receive non-browser
  /// callers (none today). Defaults to false.
  allowMissingOrigin?: boolean;
}

/// Reject anything that does not look like a same-origin browser
/// fetch from this deployment. Returns a NextResponse error to
/// short-circuit the handler, or null when the request is OK to
/// proceed.
export function assertSameOrigin(
  request: NextRequest,
  opts: GuardOptions = {},
): NextResponse | null {
  const host = request.headers.get("host");
  if (!host) {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");

  if (origin) {
    const originHost = safeUrlHost(origin);
    if (!originHost || originHost !== host) {
      return forbidden();
    }
    return null;
  }

  if (referer) {
    const refererHost = safeUrlHost(referer);
    if (!refererHost || refererHost !== host) {
      return forbidden();
    }
    return null;
  }

  if (opts.allowMissingOrigin) return null;
  return forbidden();
}

function safeUrlHost(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function forbidden(): NextResponse {
  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}

/// Best-effort client IP for rate-limit keying. Vercel sets
/// x-forwarded-for; behind other proxies use x-real-ip. Falls back
/// to a coarse bucket so callers always get a string.
export function clientIp(request: NextRequest): string {
  const xff = request.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}
