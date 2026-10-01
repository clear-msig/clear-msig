import { sha256, toHex } from "@/lib/msig/hash";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
/** This fingerprint isolates browser recovery; it is never server authorization. */
export function requestAccountKey(
  subject: string | null,
  signer: string | null,
): string {
  return toHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          subject,
          signer,
          CLEAR_WALLET_PROGRAM_ID.toBase58(),
          process.env.NEXT_PUBLIC_SOLANA_EXPECTED_GENESIS_HASH?.trim() ??
            "unconfigured",
        ]),
      ),
    ),
  );
}
