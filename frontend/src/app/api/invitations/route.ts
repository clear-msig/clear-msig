import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { buildMultisigInviteEmail } from "@/lib/email/templates/multisigInvite";

class BadRequestError extends Error {}
class ConfigError extends Error {}

function requireField(name: string, value: string | undefined) {
  if (!value || !value.trim()) {
    throw new BadRequestError(`Missing ${name}`);
  }
  return value;
}

function requireEnv(name: string, value: string | undefined) {
  if (!value || !value.trim()) {
    throw new ConfigError(name);
  }
  return value;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      walletName?: string;
      reason?: string;
      inviterAddress?: string;
      invitee?: { address?: string; email?: string };
    };

    const walletName = requireField("walletName", body.walletName);
    const inviterAddress = requireField("inviterAddress", body.inviterAddress);
    const inviteeAddress = requireField("invitee.address", body.invitee?.address);
    const inviteeEmail = requireField("invitee.email", body.invitee?.email);

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
      reason: body.reason?.trim() ?? "",
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
