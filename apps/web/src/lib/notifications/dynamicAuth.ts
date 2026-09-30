import { createPublicKey, verify, type JsonWebKey } from "node:crypto";
import type { NextRequest } from "next/server";
import { SITE_ORIGIN } from "@/lib/metadata/site";

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
  nbf?: number;
  environment_id?: string;
  scope?: string;
  scopes?: string[];
  verified_credentials?: Array<{ format?: string; chain?: string; address?: string; email?: string }>;
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
): Promise<{ userId: string; verifiedSolanaWallets: string[]; verifiedEmails: string[] }> {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) {
    throw new NotificationAuthError("Sign in to sync notifications.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (token.length > 16_384) throw new NotificationAuthError("Invalid notification session.");
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
    typeof header.kid !== "string" || !header.kid || header.kid.length > 200 ||
    typeof payload.sub !== "string" || !payload.sub ||
    payload.environment_id !== environmentId
  ) {
    throw new NotificationAuthError("Invalid notification session.");
  }

  const now = Math.floor(Date.now() / 1_000);
  if (!Number.isSafeInteger(payload.exp) || payload.exp! <= now ||
      (payload.iat !== undefined && (!Number.isSafeInteger(payload.iat) || payload.iat > now + 60)) ||
      (payload.nbf !== undefined && (!Number.isSafeInteger(payload.nbf) || payload.nbf > now + 60))) {
    throw new NotificationAuthError("Notification session expired.");
  }

  if (
    !issuerMatches(payload.iss, environmentId) ||
    !audienceMatches(payload.aud) ||
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

  const credentials = Array.isArray(payload.verified_credentials) ? payload.verified_credentials : [];
  return {
    userId: payload.sub,
    verifiedSolanaWallets: credentials.flatMap((credential) =>
      credential && credential.format === "blockchain" &&
      typeof credential.chain === "string" && ["sol", "solana"].includes(credential.chain.toLowerCase()) &&
      typeof credential.address === "string" ? [credential.address] : []),
    verifiedEmails: credentials.flatMap((credential) =>
      credential && credential.format === "email" && typeof credential.email === "string"
        ? [credential.email.trim().toLowerCase()] : []),
  };
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
  if (payload.scope !== undefined && typeof payload.scope !== "string") return true;
  if (payload.scopes !== undefined && (!Array.isArray(payload.scopes) || payload.scopes.some((scope) => typeof scope !== "string"))) return true;
  const scopes = [
    ...(payload.scope?.split(/\s+/) ?? []),
    ...(Array.isArray(payload.scopes) ? payload.scopes : []),
  ];
  return scopes.includes("requiresAdditionalAuth");
}

function audienceMatches(
  audience: DynamicJwtPayload["aud"],
): boolean {
  // Host, Origin and Referer can all be forged by a direct HTTP caller.
  // Audience trust must come from deployment configuration, on devnet too.
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim() || SITE_ORIGIN;
  let trusted: string;
  try {
    const url = new URL(configured);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return false;
    trusted = url.origin;
  } catch { return false; }
  const values = Array.isArray(audience) ? audience : audience ? [audience] : [];
  return values.some((value) => typeof value === "string" && value.replace(/\/$/, "") === trusted);
}

function decodeJson<T>(part: string | undefined): T {
  try {
    const value: unknown = JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as T;
  } catch {
    throw new NotificationAuthError("Invalid notification session.");
  }
}
