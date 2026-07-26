import { generateKeyPairSync, sign } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateNotificationRequest,
  NotificationAuthError,
} from "@/lib/notifications/dynamicAuth";

const environmentId = "09ea8ad0-0e9d-4c30-9ca3-32055373c087";

describe("notification Dynamic authentication", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("accepts a valid environment JWT and returns its subject", async () => {
    const fixture = installJwtFixture();
    const identity = await authenticateNotificationRequest(request(fixture.token));
    expect(identity).toEqual({ userId: "dynamic-user-1" });
  });

  it.each([
    ["wrong audience", { aud: "https://attacker.example" }],
    ["expired", { exp: Math.floor(Date.now() / 1_000) - 1 }],
    ["unfinished MFA", { scope: "openid requiresAdditionalAuth" }],
  ])("rejects %s tokens", async (_label, overrides) => {
    const fixture = installJwtFixture(overrides);
    await expect(authenticateNotificationRequest(request(fixture.token))).rejects.toBeInstanceOf(
      NotificationAuthError,
    );
  });

  it("rejects a token whose signature was changed", async () => {
    const fixture = installJwtFixture();
    const parts = fixture.token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.${Buffer.from("bad signature").toString("base64url")}`;
    await expect(authenticateNotificationRequest(request(tampered))).rejects.toBeInstanceOf(
      NotificationAuthError,
    );
  });
});

function installJwtFixture(overrides: Record<string, unknown> = {}) {
  vi.stubEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID", environmentId);
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const kid = `test-${Math.random()}`;
  const header = encode({ alg: "RS256", typ: "JWT", kid });
  const payload = encode({
    aud: "https://clearsig.test",
    iss: `app.dynamic.xyz/${environmentId}`,
    sub: "dynamic-user-1",
    environment_id: environmentId,
    iat: Math.floor(Date.now() / 1_000) - 10,
    exp: Math.floor(Date.now() / 1_000) + 600,
    ...overrides,
  });
  const signature = sign(
    "RSA-SHA256",
    Buffer.from(`${header}.${payload}`),
    privateKey,
  ).toString("base64url");
  const jwk = publicKey.export({ format: "jwk" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  return { token: `${header}.${payload}.${signature}` };
}

function request(token: string): NextRequest {
  return new NextRequest("https://clearsig.test/api/notifications", {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: "https://clearsig.test",
    },
  });
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
