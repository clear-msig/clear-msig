import type { PublicKey } from "@solana/web3.js";
import type { MessageFlavor } from "@/lib/msig/offchain";

export function messageFlavorForSigner(args: {
  preferSigner?: PublicKey | null;
  isLedger: boolean;
  ledgerPublicKey?: PublicKey | null;
}): MessageFlavor {
  void args;
  // Production devnet currently behaves as the plain-body verifier.
  // Use plain_v2 as the default so the signature the CLI submits is
  // accepted by the deployed program; offchain_v1 remains available
  // for Ledger / future deployments that verify wrapped bytes.
  return "plain_v2";
}
