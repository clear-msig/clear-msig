import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { buildMultisigInviteRevokedEmail } from "@/lib/email/templates/multisigInviteRevoked";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";

class BadRequestError extends Error {}
class ConfigError extends Error {}

const LIMITS = {
  walletName: 80,
  address: 64,
  email: 254,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function sanitizeHeader(value: string, max: number): string {
  return value.replace(/[\r\n\t\v\f\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
}

function requireField(name: string, value: string | undefined, max: number) {
  if (!value || !value.trim()) {
    throw new BadRequestError(`Missing ${name}`);
  }
  const cleaned = sanitizeHeader(value, max);
  if (!cleaned) throw new BadRequestError(`Missing ${name}`);
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

  // Same shape as invitations: revocation has the same abuse cost
  // as a fresh invite (it's just a different template).
  const limited = await checkRateLimit("invitations-revoke", clientIp(request), {
    capacity: 5,
    refillPerSec: 1 / 30,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      walletName?: string;
      inviterAddress?: string;
      invitee?: { address?: string; email?: string };
    };

    const walletName = requireField("walletName", body.walletName, LIMITS.walletName);
    const inviterAddress = requireField(
      "inviterAddress",
      body.inviterAddress,
      LIMITS.address,
    );
    const inviteeAddress = requireField(
      "invitee.address",
      body.invitee?.address,
      LIMITS.address,
    );
    const inviteeEmail = requireField(
      "invitee.email",
      body.invitee?.email,
      LIMITS.email,
    );

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
      auth: { user, pass },
    });

    const template = buildMultisigInviteRevokedEmail({
      walletName,
      inviterAddress,
      inviteeAddress,
    });

    await transporter.sendMail({
      from,
      to: inviteeEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ConfigError) {
      console.error(`[invitations-revoke] missing env var: ${error.message}`);
      return NextResponse.json(
        { error: "Email service unavailable" },
        { status: 503 },
      );
    }
    console.error("[invitations-revoke] failed to send revocation", error);
    return NextResponse.json(
      { error: "Failed to send revocation" },
      { status: 500 },
    );
  }
}
