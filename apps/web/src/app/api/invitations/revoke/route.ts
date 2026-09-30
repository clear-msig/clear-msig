import "server-only";

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { buildMultisigInviteRevokedEmail } from "@/lib/email/templates/multisigInviteRevoked";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { authenticateEmailRequest, EmailAuthError, requireInvitationAuthority } from "@/lib/email/authorization";
import { readBoundedBody } from "@/lib/api/body";
import { checkRateLimit } from "@/lib/api/rateLimit";

import { BadRequestError, ConfigError, requireField, requireEnv } from "@/lib/email/input";

const LIMITS = {
  walletName: 80,
  address: 64,
  email: 254,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(request: NextRequest) {
  const blocked = assertSameOrigin(request);
  if (blocked) return blocked;

  let identity;
  try { identity = await authenticateEmailRequest(request); } catch (error) {
    if (error instanceof EmailAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "Email authentication unavailable." }, { status: 503 });
  }

  // Same shape as invitations: revocation has the same abuse cost
  // as a fresh invite (it's just a different template). Match the
  // tightened bucket on the invite route - 3 burst, 1/60s refill.
  const limited = await checkRateLimit("invitations-revoke", `${identity.userId}:${clientIp(request)}`, {
    capacity: 3,
    refillPerSec: 1 / 60,
  });
  if (limited) return limited;

  const raw = await readBoundedBody(request, 16_000);
  if (!raw.ok) return raw.response;
  let parsed: unknown;
  try { parsed = JSON.parse(raw.text); } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return NextResponse.json({ error: "Body must be a JSON object." }, { status: 400 });
  }
  try {
    const body = parsed as {
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

    await requireInvitationAuthority(identity, walletName, inviterAddress);

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
    if (error instanceof EmailAuthError) return NextResponse.json({ error: error.message }, { status: error.status });
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
