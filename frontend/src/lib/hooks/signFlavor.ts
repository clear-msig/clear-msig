import { PublicKey } from "@solana/web3.js";
import type { MessageFlavor } from "@/lib/msig/offchain";

export function messageFlavorForSigner(args: {
  preferSigner?: PublicKey | null;
  isLedger: boolean;
  ledgerPublicKey?: PublicKey | null;
}): MessageFlavor {
  // Ledger needs the Solana offchain envelope so the device renders
  // the body as clear text. Software wallets sign the plain body for
  // deployment compatibility. Use the actual routed signer when the
  // caller passed `preferSigner`; a connected Ledger should not force
  // offchain bytes if this request is being signed by Dynamic/Phantom.
  if (args.preferSigner && args.ledgerPublicKey) {
    return args.preferSigner.equals(args.ledgerPublicKey)
      ? "offchain_v1"
      : "plain_v2";
  }
  return args.isLedger ? "offchain_v1" : "plain_v2";
}
