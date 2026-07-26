import { Connection, PublicKey } from "@solana/web3.js";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import {
  deriveAssociatedTokenAddress,
  SOLANA_DEVNET_USDC,
} from "@/lib/chain/solanaTokens";
import { findVaultAddress } from "@/lib/msig/pda";

export interface RecurringTokenAccounts {
  mint: string;
  sourceToken: string;
  destinationToken: string;
  recipientOwner: string;
}

export async function resolveRecurringUsdcAccounts(
  connection: Connection,
  recipient: string,
  wallet: PublicKey,
): Promise<RecurringTokenAccounts> {
  let recipientOwner: PublicKey;
  try {
    recipientOwner = new PublicKey(recipient.trim());
  } catch {
    throw new Error("Enter a valid Solana recipient address.");
  }
  const mint = new PublicKey(SOLANA_DEVNET_USDC.mint);
  const vault = findVaultAddress(wallet, CLEAR_WALLET_PROGRAM_ID)[0];
  const sourceToken = deriveAssociatedTokenAddress(vault, mint);
  const destinationToken = deriveAssociatedTokenAddress(recipientOwner, mint);
  const [source, destination] = await connection.getMultipleAccountsInfo(
    [sourceToken, destinationToken],
    "confirmed",
  );
  if (!source) {
    throw new Error(
      "This treasury does not have an initialized devnet USDC token account.",
    );
  }
  if (!destination) {
    throw new Error(
      "The recipient needs an initialized devnet USDC token account before scheduling.",
    );
  }
  return {
    mint: mint.toBase58(),
    sourceToken: sourceToken.toBase58(),
    destinationToken: destinationToken.toBase58(),
    recipientOwner: recipientOwner.toBase58(),
  };
}
