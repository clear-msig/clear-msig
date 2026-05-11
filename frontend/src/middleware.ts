// Per-request CSP nonce + report-only strict policy.
//
// The enforced CSP lives in next.config.ts and intentionally allows
// 'unsafe-inline' / 'unsafe-eval' because Next 15's hydration scripts
// and the Dynamic SDK's wallet popup currently require them.
//
// This middleware adds a second policy as Content-Security-Policy-
// Report-Only that DROPS 'unsafe-inline' / 'unsafe-eval' and instead
// pins inline scripts to a per-request nonce + 'strict-dynamic'.
// Browsers will report violations without blocking, so we get a real
// inventory of what blocks the strict policy from being enforced.
// Once the report stream is clean we flip to active enforcement by
// renaming the header in this file (one-line change).
//
// The nonce is also forwarded as `x-nonce` so server components can
// read it via `headers()` and stamp it onto any custom `<Script>` tag
// they emit. Next's framework boot scripts pick it up automatically.

import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const nonce = generateNonce();

  const reportOnlyCsp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    "style-src 'self' 'unsafe-inline' https:",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    // Local dev fallback for http://127.0.0.1:* + http://localhost:*
    // matches next.config.ts. Production gets the strict policy
    // (HTTPS-only) so localhost can't appear in any deployed
    // response. See next.config.ts for the rationale.
    process.env.NODE_ENV === "production"
      ? "connect-src 'self' https: wss:"
      : "connect-src 'self' https: wss: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
    "frame-src 'self' https:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "worker-src 'self' blob:",
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy-Report-Only", reportOnlyCsp);
  return response;
}

function generateNonce(): string {
  // 16 random bytes → base64. crypto is the Web Crypto polyfill on
  // Edge; available without imports.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export const config = {
  // Skip Next-internal asset paths and the API routes (those have
  // their own JSON-only response shape and don't render HTML, so a
  // CSP nonce isn't meaningful for them).
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|opengraph-image).*)",
  ],
};
