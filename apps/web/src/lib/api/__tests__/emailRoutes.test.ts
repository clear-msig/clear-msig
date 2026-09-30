import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mail = vi.hoisted(() => ({ send: vi.fn(), auth: vi.fn(), authority: vi.fn(), verifiedEmail: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/email/authorization", () => ({
  authenticateEmailRequest: mail.auth,
  requireInvitationAuthority: mail.authority,
  requireVerifiedNotificationEmail: mail.verifiedEmail,
  EmailAuthError: class extends Error { constructor(message: string, readonly status = 401) { super(message); } },
}));
import { EmailAuthError } from "@/lib/email/authorization";

vi.mock("nodemailer", () => ({ default: { createTransport: () => ({ sendMail: mail.send }) } }));
vi.mock("@/lib/api/rateLimit", () => ({ checkRateLimit: async () => null }));
import * as invites from "@/app/api/invitations/route";
import * as revocations from "@/app/api/invitations/revoke/route";
import * as pending from "@/app/api/notify-pending/route";

beforeEach(() => {
  mail.send.mockReset(); mail.send.mockResolvedValue({});
  mail.auth.mockReset(); mail.auth.mockResolvedValue({ userId: "verified-user", verifiedSolanaWallets: ["11111111111111111111111111111111"], verifiedEmails: ["recipient@example.test"] });
  mail.authority.mockReset(); mail.authority.mockResolvedValue(undefined);
  mail.verifiedEmail.mockReset();
  for (const name of ["SMTP_HOST", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]) vi.stubEnv(name, "test-value");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://clearsig.test");
});
afterEach(() => vi.unstubAllEnvs());
const pubkey = "11111111111111111111111111111111";
function request(body: unknown, headers?: HeadersInit, raw = false) {
  return new NextRequest("https://clearsig.test/api/mail", { method: "POST",
    headers: { host: "clearsig.test", origin: "https://clearsig.test", "content-type": "application/json", ...headers },
    body: raw ? String(body) : JSON.stringify(body),
  });
}
for (const [name, route] of [["invite", invites], ["revoke", revocations], ["pending", pending]] as const) {
  describe(`${name} email input`, () => {
    it("requires authentication before any SMTP side effect", async () => {
      mail.auth.mockRejectedValueOnce(new EmailAuthError("Sign in", 401));
      expect((await route.POST(request({}))).status).toBe(401);
      expect(mail.send).not.toHaveBeenCalled();
    });
    it.each([null, [], "text", { walletName: 42 }])("rejects malformed values before SMTP", async (body) => {
      expect((await route.POST(request(body))).status).toBe(400);
      expect(mail.send).not.toHaveBeenCalled();
    });
    it("rejects invalid JSON before SMTP", async () => {
      expect((await route.POST(request("{", undefined, true))).status).toBe(400);
      expect(mail.send).not.toHaveBeenCalled();
    });
    it("limits streamed bytes without Content-Length", async () => {
      expect((await route.POST(request({ padding: "x".repeat(16_001) }))).status).toBe(413);
      expect(mail.send).not.toHaveBeenCalled();
    });
  });
}
describe("trusted branded email links", () => {
  it("ignores forged Host and forwarded protocol for notification destination", async () => {
    const response = await pending.POST(request({ email: "recipient@example.test", walletName: "Team", intentLabel: "Send", proposalPda: pubkey }, {
      host: "attacker.example", origin: "https://attacker.example", "x-forwarded-proto": "javascript",
    }));
    expect(response.status).toBe(200);
    const message = mail.send.mock.calls[0][0];
    expect(message.text).toContain(`https://clearsig.test/app/proposals/${pubkey}`);
    expect(message.html).not.toContain("attacker.example");
    expect(message.html).not.toContain("javascript:");
  });
  it("rejects overlong fields rather than silently changing recipient identity", async () => {
    const response = await invites.POST(request({ walletName: "Team", inviterAddress: pubkey, invitee: { address: pubkey, email: `${"a".repeat(250)}@example.test` } }));
    expect(response.status).toBe(400);
    expect(mail.send).not.toHaveBeenCalled();
  });
});
