import {
  describeWalletRights,
  describeWalletRole,
  type WalletRole,
} from "@/lib/retail/memberAccess";

type InviteTemplateInput = {
  walletName: string;
  reason: string;
  inviteeAddress: string;
  inviterAddress: string;
  role: WalletRole;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildMultisigInviteEmail(input: InviteTemplateInput) {
  const walletName = escapeHtml(input.walletName);
  const reason = input.reason ? escapeHtml(input.reason) : "No reason provided";
  const inviterAddress = escapeHtml(input.inviterAddress);
  const inviteeAddress = escapeHtml(input.inviteeAddress);
  const role = escapeHtml(describeWalletRole(input.role));
  const rights = escapeHtml(describeWalletRights(input.role));

  const subject = `You were added to ${input.walletName} as ${describeWalletRole(input.role)}`;
  const titleHtml = escapeHtml(subject);

  const html = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${titleHtml}</title>
    </head>
    <body style="margin:0;padding:0;background:#090909;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#101010;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;">
              <tr>
                <td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
                  <h1 style="margin:0;font-size:20px;line-height:1.2;">You're in</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 24px;">
                  <p style="margin:0 0 12px 0;color:#d0d0d0;font-size:14px;line-height:1.6;">You were added to a shared wallet on Clear as ${role}. ${rights}</p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0b;border:1px solid #2a2a2a;border-radius:10px;">
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Wallet</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${walletName}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Access</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${role}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Rights</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${rights}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Note</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${reason}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Added by</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${inviterAddress}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Your address</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${inviteeAddress}</td></tr>
                  </table>
                  <p style="margin:14px 0 0 0;color:#8f8f8f;font-size:12px;line-height:1.5;">Open Clear in your browser and connect your wallet to see this shared wallet alongside any others you're already in.</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </body>
  </html>
  `;

  const text = [
    "You're in",
    `You were added to a shared wallet on Clear: ${input.walletName}`,
    `Access: ${describeWalletRole(input.role)}`,
    `Rights: ${describeWalletRights(input.role)}`,
    `Note: ${input.reason || "No note provided"}`,
    `Added by: ${input.inviterAddress}`,
    `Your address: ${input.inviteeAddress}`,
    "",
    "Open Clear and connect your wallet to see it.",
  ].join("\n");

  return { subject, html, text };
}
