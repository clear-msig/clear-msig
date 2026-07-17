type RevokeTemplateInput = {
  walletName: string;
  inviteeAddress: string;
  inviterAddress: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildMultisigInviteRevokedEmail(input: RevokeTemplateInput) {
  const walletName = escapeHtml(input.walletName);
  const inviterAddress = escapeHtml(input.inviterAddress);
  const inviteeAddress = escapeHtml(input.inviteeAddress);

  const subject = `Invite to ${input.walletName} was withdrawn`;
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
                  <h1 style="margin:0;font-size:20px;line-height:1.2;">Invite withdrawn</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 24px;">
                  <p style="margin:0 0 12px 0;color:#d0d0d0;font-size:14px;line-height:1.6;">The invite you received to a shared wallet on Clear was withdrawn by the person who sent it. You can ignore the previous email - there's nothing for you to do.</p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0b;border:1px solid #2a2a2a;border-radius:10px;">
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Wallet</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${walletName}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Withdrawn by</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${inviterAddress}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Your address</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${inviteeAddress}</td></tr>
                  </table>
                  <p style="margin:14px 0 0 0;color:#8f8f8f;font-size:12px;line-height:1.5;">If you think this was a mistake, reach out to the sender directly. Clear can't restore the invite for you - they need to send a fresh one.</p>
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
    "Invite withdrawn",
    `The invite to ${input.walletName} on Clear was withdrawn by the sender.`,
    `Wallet: ${input.walletName}`,
    `Withdrawn by: ${input.inviterAddress}`,
    `Your address: ${input.inviteeAddress}`,
    "",
    "You can ignore the previous email. If this was a mistake, reach out to the sender - Clear can't restore the invite, they need to send a new one.",
  ].join("\n");

  return { subject, html, text };
}
