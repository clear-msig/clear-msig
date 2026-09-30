import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: vi.fn(), member: vi.fn(), limit: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/notifications/dynamicAuth", () => ({ authenticateNotificationRequest: mocks.auth }));
vi.mock("@/lib/auth/walletAuthorization", () => ({ authenticateWalletMember: mocks.member, walletAuthorizationFailure: () => NextResponse.json({ error: "denied" }, { status: 401 }) }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: mocks.limit }));
import { authorizeBackendProxy } from "../backendAuthorization";
const actor = "11111111111111111111111111111111";
function request(method = "POST") { return new NextRequest("https://app.test/api/backend", { method }); }
beforeEach(() => {
  vi.stubEnv("CLEAR_MSIG_BACKEND_GATEWAY_TOKEN", "test-only-gateway-token-32-characters-minimum");
  mocks.auth.mockReset(); mocks.auth.mockResolvedValue({ userId: "subject", verifiedSolanaWallets: [actor] });
  mocks.member.mockReset(); mocks.member.mockResolvedValue({});
  mocks.limit.mockReset(); mocks.limit.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());
describe("private backend gateway", () => {
  it("preserves public and independently signed endpoint transport", async () => {
    expect(await authorizeBackendProxy(request("GET"), ["health"])).toEqual({ ok: true, headers: {} });
    expect(await authorizeBackendProxy(request(), ["wallets", "team", "proposals", "submit"], "{}")).toEqual({ ok: true, headers: {} });
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("fails closed when the gateway credential is missing", async () => {
    vi.stubEnv("CLEAR_MSIG_BACKEND_GATEWAY_TOKEN", "");
    const result = await authorizeBackendProxy(request(), ["wallets"], "{}");
    expect(result.ok).toBe(false); if (!result.ok) expect(result.response.status).toBe(503);
  });
  it("only sponsors creation containing a session-verified Solana identity", async () => {
    const result = await authorizeBackendProxy(request(), ["wallets"], JSON.stringify({ proposers: [actor], approvers: [actor] }));
    expect(result).toEqual({ ok: true, headers: { "x-clearsig-backend-token": "test-only-gateway-token-32-characters-minimum" } });
    const rejected = await authorizeBackendProxy(request(), ["wallets"], JSON.stringify({ proposers: ["someone-else"], approvers: [] }));
    expect(rejected.ok).toBe(false); if (!rejected.ok) expect(rejected.response.status).toBe(403);
    expect(mocks.limit).toHaveBeenCalledOnce();
  });
  it("verifies canonical current membership for private Pro reads and writes", async () => {
    await authorizeBackendProxy(request("GET"), ["v1", "pro", "wallets", "team", "schedules"]);
    expect(mocks.member).toHaveBeenLastCalledWith(expect.any(NextRequest), "team");
    await authorizeBackendProxy(request(), ["v1", "pro", "audit-events"], JSON.stringify({ walletName: "other" }));
    expect(mocks.member).toHaveBeenLastCalledWith(expect.any(NextRequest), "other");
    mocks.member.mockRejectedValueOnce(new Error("not a member"));
    expect((await authorizeBackendProxy(request("GET"), ["v1", "pro", "wallets", "other", "schedules"])).ok).toBe(false);
  });
  it("never exposes creator/operator chain bootstrap through member gateway", async () => {
    const result = await authorizeBackendProxy(request(), ["wallets", "team", "chains", "add"], "{}");
    expect(result.ok).toBe(false); if (!result.ok) expect(result.response.status).toBe(403);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
  it("rejects path normalization tricks before attaching operator authority", async () => {
    for (const part of ["..", ".", "a/b", "a\\b"]) {
      const result = await authorizeBackendProxy(request("GET"), ["v1", "pro", "wallets", part, "wallets", "victim", "schedules"]);
      expect(result.ok).toBe(false); if (!result.ok) expect(result.response.status).toBe(400);
    }
    expect(mocks.member).not.toHaveBeenCalled();
  });
});
