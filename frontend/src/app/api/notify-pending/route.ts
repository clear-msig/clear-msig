// /api/notify-pending — fires an email to a user who's opted in
// when their browser sees a new pending approval. Same SMTP infra
// as /api/invitations, separate route so rate limits don't
// cross-contaminate (invitations are sent person-to-person; this
// is fired by the same person to themselves).
//
// Threat model:
//   - Same-origin check + per-IP rate limit defend against
//     trivial spam from a hostile origin.
//   - The endpoint takes a destination email from the body — anyone
//     who finds the route can ask us to email arbitrary addresses.
//     Pre-alpha tradeoff: per-IP rate limit caps the abuse window
//     to ~1 email / 30s; production would key opt-in to a
//     server-stored verified address keyed by signed pubkey.
//   - The proposal URL is built server-side from the proposal PDA
//     plus the request's own origin, NOT taken from the body. An
//     attacker with same-origin XSS could otherwise trick the
//     endpoint into sending fully-branded "Clear" emails whose
//     "Open the proposal" link points anywhere — turning the route
//     into a high-deliverability phishing relay. The origin pin
//     means every link in every email anchors to this deployment.
//
// On the headers we sanitize: nodemailer respects user-supplied
// CR/LF as separator characters by default; sanitizeHeader strips
// them so a hostile body can't inject a Bcc / extra subject line.

import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { assertSameOrigin, clientIp } from "@/lib/api/guard";
import { checkRateLimit } from "@/lib/api/rateLimit";

class BadRequestError extends Error {}
class ConfigError extends Error {}

const LIMITS = {
  walletName: 80,
  intentLabel: 200,
  email: 254,
  proposalPda: 64,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Solana addresses are base58 32-44 chars. Pin proposalPda to that
// shape so a malicious body can't smuggle path traversal or
// arbitrary characters into the URL we build.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function sanitize(value: string, max: number): string {
  return value.replace(/[\r\n\t\v\f\x00-\x1f\x7f]/g, " ").trim().slice(0, max);
}

function requireField(name: string, value: string | undefined, max: number) {
  if (!value || !value.trim()) {
    throw new BadRequestError(`Missing ${name}`);
  }
  const cleaned = sanitize(value, max);
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

  // Tighter than invitations — there's no person-to-person reason
  // to fire two of these in the same minute. 3 burst, refill 1 per
  // 30s.
  const limited = await checkRateLimit("notify-pending", clientIp(request), {
    capacity: 3,
    refillPerSec: 1 / 30,
  });
  if (limited) return limited;

  try {
    const body = (await request.json()) as {
      email?: string;
      walletName?: string;
      intentLabel?: string;
      approvalsCollected?: number;
      approverCount?: number;
      proposalPda?: string;
    };

    const email = requireField("email", body.email, LIMITS.email);
    const walletName = requireField(
      "walletName",
      body.walletName,
      LIMITS.walletName,
    );
    const intentLabel = requireField(
      "intentLabel",
      body.intentLabel,
      LIMITS.intentLabel,
    );
    const proposalPda = requireField(
      "proposalPda",
      body.proposalPda,
      LIMITS.proposalPda,
    );
    if (!EMAIL_RE.test(email)) {
      throw new BadRequestError("Invalid email address");
    }
    if (!BASE58_RE.test(proposalPda)) {
      throw new BadRequestError("Invalid proposal id");
    }
    // Build the URL server-side from the request's own origin so the
    // CTA in every email always points at this deployment. Drops the
    // body-supplied URL entirely.
    const requestHost = request.headers.get("host") ?? "clear-msig.vercel.app";
    const protocol =
      request.headers.get("x-forwarded-proto") ??
      (requestHost.startsWith("localhost") ? "http" : "https");
    const proposalUrl = `${protocol}://${requestHost}/app/proposals/${encodeURIComponent(proposalPda)}`;
    const collected = clampNumber(body.approvalsCollected ?? 0);
    const total = clampNumber(body.approverCount ?? 0);

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

    const subject = `${walletName}: ${intentLabel} needs your approval`;
    const text =
      `${walletName} has a request waiting on your approval.\n\n` +
      `${intentLabel}\n` +
      (total > 0 ? `${collected}/${total} approvals so far\n\n` : "\n") +
      `Open the proposal:\n${proposalUrl}\n\n` +
      `— Clear (https://clear-msig.vercel.app/)`;
    const html =
      `<!doctype html><html><body style="font-family:system-ui,Helvetica,Arial,sans-serif;color:#0f172a;max-width:540px;margin:24px auto;padding:0 16px;">` +
      `<p style="font-size:13px;color:#71717a;text-transform:uppercase;letter-spacing:0.18em;margin:0">Pending approval</p>` +
      `<h1 style="font-size:22px;font-weight:600;margin:8px 0 0;line-height:1.25">${escapeHtml(walletName)}: ${escapeHtml(intentLabel)}</h1>` +
      (total > 0
        ? `<p style="margin:12px 0;color:#71717a">${collected} of ${total} approvals collected so far.</p>`
        : "") +
      `<p style="margin:24px 0"><a href="${escapeHtml(proposalUrl)}" style="display:inline-block;background:#16a34a;color:#fff;padding:10px 16px;border-radius:9999px;text-decoration:none;font-weight:500">Open the proposal</a></p>` +
      `<p style="font-size:12px;color:#a1a1aa;margin-top:32px">You opted into these emails on Clear&rsquo;s Settings page. Turn them off there if you&rsquo;d rather rely on the in-app badge.</p>` +
      `</body></html>`;

    await transporter.sendMail({
      from,
      to: email,
      subject: sanitize(subject, 256),
      html,
      text,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof BadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ConfigError) {
      return NextResponse.json(
        { error: `SMTP not configured (${error.message})` },
        { status: 500 },
      );
    }
    console.error("[notify-pending]", error);
    return NextResponse.json(
      { error: "Failed to send notification email" },
      { status: 500 },
    );
  }
}

function clampNumber(n: unknown): number {
  if (typeof n !== "number") return 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(99, Math.floor(n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
