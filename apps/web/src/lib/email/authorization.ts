import "server-only";
import { PublicKey } from "@solana/web3.js";
import { authenticateNotificationRequest, NotificationAuthError } from "@/lib/notifications/dynamicAuth";
import { getConnection, CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";
import { fetchWalletByName } from "@/lib/chain/wallets";
import { findIntentAddress, parseIntent } from "@/lib/msig";

export { NotificationAuthError as EmailAuthError };
export const authenticateEmailRequest = authenticateNotificationRequest;
export type EmailIdentity = Awaited<ReturnType<typeof authenticateEmailRequest>>;

export async function requireInvitationAuthority(identity: EmailIdentity, walletName: string, actor: string): Promise<void> {
  if (!identity.verifiedSolanaWallets.includes(actor)) {
    throw new NotificationAuthError("The signed-in session does not verify this inviter wallet.", 403);
  }
  const connection = getConnection();
  const wallet = await fetchWalletByName(connection, walletName);
  if (!wallet) throw new NotificationAuthError("Wallet is unavailable.", 403);
  const [intent] = findIntentAddress(wallet.pda, 0, CLEAR_WALLET_PROGRAM_ID);
  const info = await connection.getAccountInfo(intent, DEFAULT_COMMITMENT);
  if (!info?.owner.equals(CLEAR_WALLET_PROGRAM_ID)) throw new NotificationAuthError("Invitation authority is unavailable.", 403);
  const policy = parseIntent(new Uint8Array(info.data));
  if (!policy.approved || policy.wallet !== wallet.pda.toBase58() ||
      ![...policy.proposers, ...policy.approvers].includes(new PublicKey(actor).toBase58())) {
    throw new NotificationAuthError("This wallet cannot invite members to the selected treasury.", 403);
  }
}

export function requireVerifiedNotificationEmail(identity: EmailIdentity, email: string): void {
  if (!identity.verifiedEmails.includes(email.trim().toLowerCase())) {
    throw new NotificationAuthError("Approval emails can only be sent to your verified sign-in email.", 403);
  }
}
