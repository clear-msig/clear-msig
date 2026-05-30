import type { PublicKey } from "@solana/web3.js";
import type { MessageFlavor } from "@/lib/msig/offchain";

export function messageFlavorForSigner(args: {
  preferSigner?: PublicKey | null;
  isLedger: boolean;
  ledgerPublicKey?: PublicKey | null;
}): MessageFlavor {
  // The deployed program verifies the Solana offchain-wrapped message.
  // Keep every signer on that canonical payload; the local wallet verify
  // still catches providers that mangle the leading 0xff byte.
  void args;
  return "offchain_v1";
}
