import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { buildMultisigInviteEmail } from "@/lib/email/templates/multisigInvite";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";

class BadRequestError extends Error {}
class ConfigError extends Error {}

const LIMITS = {
  walletName: 80,
  reason: 500,
  address: 64,
  email: 254,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/// Strip CR/LF and other control characters that nodemailer / SMTP
/// servers treat as header separators. Defence-in-depth on top of
/// nodemailer's own sanitization.
function sanitizeHeader(value: string, max: number): string {
  return value.replace(/[\r\n\t\v\f\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
}

function requireField(name: string, value: string | undefined, max: number) {
  if (!value || !value.trim()) {
    throw new BadRequestError(`Missing ${name}`);
  }
  const cleaned = sanitizeHeader(value, max);
  if (!cleaned) {
    throw new BadRequestError(`Missing ${name}`);
  }
  return cleaned;
}

function requireEnv(name: string, value: string | undefined) {
  if (!value || !value.trim()) {
    throw new ConfigError(name);
  }
  return value;
}

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  // Email is paid + reputational. The body's `invitee.email` is
  // user-supplied - we cannot pin it without a server-side
  // verified-pubkey → verified-email mapping, which is on the
  // hardening backlog. Until then, the rate limit is the only
  // brake on a same-origin XSS turning this into a branded-spam
  // relay. Tight bucket: 3 burst, refill one every 60 seconds. A
  // real signer never trips this - invites land at human pace.
  // The limiter is in-process by default; ensure the prod env has
  // UPSTASH_REDIS_REST_URL + _TOKEN set so the budget is shared
  // across cold-start instances.
  const limited = await checkRateLimit("invitations", clientIp(request), {
    capacity: 3,
    refillPerSec: 1 / 60,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      walletName?: string;
      reason?: string;
      inviterAddress?: string;
      invitee?: { address?: string; email?: string };
    };

    const walletName = requireField("walletName", body.walletName, LIMITS.walletName);
    const inviterAddress = requireField("inviterAddress", body.inviterAddress, LIMITS.address);
    const inviteeAddress = requireField("invitee.address", body.invitee?.address, LIMITS.address);
    const inviteeEmail = requireField("invitee.email", body.invitee?.email, LIMITS.email);
    const reason = sanitizeHeader(body.reason ?? "", LIMITS.reason);

    if (!EMAIL_RE.test(inviteeEmail)) {
      throw new BadRequestError("Invalid email address");
    }
    if (!BASE58_RE.test(inviterAddress) || !BASE58_RE.test(inviteeAddress)) {
      throw new BadRequestError("Invalid wallet address");
    }

    const host = requireEnv("SMTP_HOST", process.env.SMTP_HOST);
    const port = Number(process.env.SMTP_PORT ?? "587");
    const user = requireEnv("SMTP_USER", process.env.SMTP_USER);
    const pass = requireEnv("SMTP_PASS", process.env.SMTP_PASS);
    const from = requireEnv("SMTP_FROM", process.env.SMTP_FROM);

    const transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });

    const template = buildMultisigInviteEmail({
      walletName,
      reason,
      inviterAddress,
      inviteeAddress
    });

    await transporter.sendMail({
      from,
      to: inviteeEmail,
      subject: template.subject,
      html: template.html,
      text: template.text
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ConfigError) {
      console.error(`[invitations] missing env var: ${error.message}`);
      return NextResponse.json({ error: "Email service unavailable" }, { status: 503 });
    }
    console.error("[invitations] failed to send invite", error);
    return NextResponse.json({ error: "Failed to send invite" }, { status: 500 });
  }
}
