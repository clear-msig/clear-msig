// Direct-RPC wallet reader. One `getAccountInfo` roundtrip + a
// client-side PDA derivation . no backend dependency.

import { Connection, PublicKey } from "@solana/web3.js";
import {
  findWalletAddress,
  parseWallet,
  type WalletAccount,
} from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";

export interface WalletWithPda {
  name: string;
  pda: PublicKey;
  bump: number;
  account: WalletAccount;
}

/// Fetch a wallet by its human-readable name. Returns `null` when the
/// account isn't on chain . callers decide whether to show an empty
/// state or an error.
export async function fetchWalletByName(
  connection: Connection,
  name: string
): Promise<WalletWithPda | null> {
  const [pda, bump] = findWalletAddress(name, CLEAR_WALLET_PROGRAM_ID);
  const info = await connection.getAccountInfo(pda, DEFAULT_COMMITMENT);
  if (!info) return null;
  const account = parseWallet(new Uint8Array(info.data));
  return { name, pda, bump, account };
}

/// Fetch a wallet by its PDA when the caller already has the address
/// (e.g. from a memberships lookup). Returns `null` for a missing
/// account; throws if the account exists but isn't a ClearWallet
/// (wrong discriminator).
export async function fetchWalletByPda(
  connection: Connection,
  pda: PublicKey
): Promise<WalletAccount | null> {
  const info = await connection.getAccountInfo(pda, DEFAULT_COMMITMENT);
  if (!info) return null;
  return parseWallet(new Uint8Array(info.data));
}
