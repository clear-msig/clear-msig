type InviteTemplateInput = {
  walletName: string;
  reason: string;
  inviteeAddress: string;
  inviterAddress: string;
};

export function buildMultisigInviteEmail(input: InviteTemplateInput) {
  const subject = `You were added to ${input.walletName}`;

  const html = `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${subject}</title>
    </head>
    <body style="margin:0;padding:0;background:#090909;font-family:Arial,Helvetica,sans-serif;color:#ffffff;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:24px 12px;">
        <tr>
          <td align="center">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#101010;border:1px solid #2a2a2a;border-radius:14px;overflow:hidden;">
              <tr>
                <td style="padding:20px 24px;border-bottom:1px solid #2a2a2a;">
                  <h1 style="margin:0;font-size:20px;line-height:1.2;">Multisig invitation</h1>
                </td>
              </tr>
              <tr>
                <td style="padding:22px 24px;">
                  <p style="margin:0 0 12px 0;color:#d0d0d0;font-size:14px;line-height:1.6;">You have been added as a signer in a Clear-MSIG organization.</p>
                  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0b0b0b;border:1px solid #2a2a2a;border-radius:10px;">
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Organization</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${input.walletName}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Reason</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${input.reason || "No reason provided"}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Inviter</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${input.inviterAddress}</td></tr>
                    <tr><td style="padding:12px 14px;color:#8f8f8f;font-size:12px;">Your wallet</td><td style="padding:12px 14px;color:#ffffff;font-size:13px;">${input.inviteeAddress}</td></tr>
                  </table>
                  <p style="margin:14px 0 0 0;color:#8f8f8f;font-size:12px;line-height:1.5;">Connect your wallet in the dashboard to review and approve proposals for this organization.</p>
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
    "Multisig invitation",
    `Organization: ${input.walletName}`,
    `Reason: ${input.reason || "No reason provided"}`,
    `Inviter: ${input.inviterAddress}`,
    `Your wallet: ${input.inviteeAddress}`
  ].join("\n");

  return { subject, html, text };
}
