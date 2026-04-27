import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { buildMultisigInviteEmail } from "@/lib/email/templates/multisigInvite";

function required(name: string, value: string | undefined) {
  if (!value || !value.trim()) {
    throw new Error(`Missing ${name}`);
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

    const walletName = required("walletName", body.walletName);
    const inviterAddress = required("inviterAddress", body.inviterAddress);
    const inviteeAddress = required("invitee.address", body.invitee?.address);
    const inviteeEmail = required("invitee.email", body.invitee?.email);

    const host = required("SMTP_HOST", process.env.SMTP_HOST);
    const port = Number(process.env.SMTP_PORT ?? "587");
    const user = required("SMTP_USER", process.env.SMTP_USER);
    const pass = required("SMTP_PASS", process.env.SMTP_PASS);
    const from = required("SMTP_FROM", process.env.SMTP_FROM);

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
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send invite" },
      { status: 400 }
    );
  }
}
