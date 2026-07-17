import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import type { NextRequest } from "next/server";

interface DynamicJwtHeader {
  alg?: string;
  kid?: string;
}

interface DynamicJwtPayload {
  aud?: string | string[];
  iss?: string;
  sub?: string;
  exp?: number;
  iat?: number;
  environment_id?: string;
  scope?: string;
  scopes?: string[];
}

interface DynamicJwks {
  keys?: JsonWebKey[];
}

export class NotificationAuthError extends Error {
  constructor(message: string, readonly status = 401) {
    super(message);
  }
}

const keyCache = new Map<string, { key: JsonWebKey; expiresAt: number }>();
const KEY_TTL_MS = 60 * 60 * 1_000;

export async function authenticateNotificationRequest(
  request: NextRequest,
): Promise<{ userId: string }> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new NotificationAuthError("Sign in to sync notifications.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new NotificationAuthError("Invalid notification session.");
  }

  const header = decodeJson<DynamicJwtHeader>(parts[0]);
  const payload = decodeJson<DynamicJwtPayload>(parts[1]);
  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID?.trim();
  if (!environmentId) {
    throw new NotificationAuthError("Notification authentication is not configured.", 503);
  }
  if (
    header.alg !== "RS256" ||
    !header.kid ||
    !payload.sub ||
    payload.environment_id !== environmentId
  ) {
    throw new NotificationAuthError("Invalid notification session.");
  }

  const now = Math.floor(Date.now() / 1_000);
  if (!payload.exp || payload.exp <= now || (payload.iat && payload.iat > now + 60)) {
    throw new NotificationAuthError("Notification session expired.");
  }

  if (
    !issuerMatches(payload.iss, environmentId) ||
    !audienceMatches(payload.aud, request) ||
    requiresAdditionalAuth(payload)
  ) {
    throw new NotificationAuthError("Invalid notification session scope.");
  }

  const jwk = await dynamicSigningKey(environmentId, header.kid);
  const signingInput = Buffer.from(`${parts[0]}.${parts[1]}`);
  const signature = Buffer.from(parts[2], "base64url");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  if (!verify("RSA-SHA256", signingInput, publicKey, signature)) {
    throw new NotificationAuthError("Invalid notification session signature.");
  }

  return { userId: payload.sub };
}

async function dynamicSigningKey(
  environmentId: string,
  kid: string,
): Promise<JsonWebKey> {
  const cacheKey = `${environmentId}:${kid}`;
  const cached = keyCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.key;

  const configured = process.env.DYNAMIC_API_BASE_URL?.trim().replace(/\/+$/, "");
  const bases = [
    configured,
    "https://app.dynamic.xyz/api/v0",
    "https://app.dynamicauth.com/api/v0",
  ].filter((value, index, all): value is string => !!value && all.indexOf(value) === index);
  for (const apiBase of bases) {
    try {
      const response = await fetch(
        `${apiBase}/sdk/${encodeURIComponent(environmentId)}/.well-known/jwks`,
        { signal: AbortSignal.timeout(3_000), next: { revalidate: 3_600 } },
      );
      if (!response.ok) continue;
      const payload = (await response.json()) as DynamicJwks;
      const key = payload.keys?.find(
        (candidate) => candidate.kid === kid && candidate.kty === "RSA",
      );
      if (!key) continue;
      keyCache.set(cacheKey, { key, expiresAt: Date.now() + KEY_TTL_MS });
      return key;
    } catch {
      // Try the next official Dynamic API hostname.
    }
  }
  throw new NotificationAuthError("Notification authentication is unavailable.", 503);
}

function issuerMatches(issuer: string | undefined, environmentId: string): boolean {
  return new Set([
    `app.dynamic.xyz/${environmentId}`,
    `https://app.dynamic.xyz/${environmentId}`,
    `app.dynamicauth.com/${environmentId}`,
    `https://app.dynamicauth.com/${environmentId}`,
  ]).has(issuer ?? "");
}

function requiresAdditionalAuth(payload: DynamicJwtPayload): boolean {
  const scopes = [
    ...(payload.scope?.split(/\s+/) ?? []),
    ...(Array.isArray(payload.scopes) ? payload.scopes : []),
  ];
  return scopes.includes("requiresAdditionalAuth");
}

function audienceMatches(
  audience: DynamicJwtPayload["aud"],
  request: NextRequest,
): boolean {
  const candidates = new Set<string>();
  candidates.add(request.nextUrl.origin);
  const origin = request.headers.get("origin");
  if (origin) candidates.add(origin);
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      candidates.add(new URL(referer).origin);
    } catch {
      // Invalid referers are rejected by the same-origin guard.
    }
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      candidates.add(new URL(configured).origin);
    } catch {
      // A malformed optional URL must not broaden the accepted audience.
    }
  }
  const values = Array.isArray(audience) ? audience : audience ? [audience] : [];
  return values.some((value) => candidates.has(value.replace(/\/$/, "")));
}

function decodeJson<T>(part: string | undefined): T {
  try {
    return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8")) as T;
  } catch {
    throw new NotificationAuthError("Invalid notification session.");
  }
}
