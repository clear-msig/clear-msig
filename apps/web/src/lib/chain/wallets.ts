// Direct-RPC wallet reader.
//
// As of the creator-scoped PDA upgrade (2026-05-03), wallet PDAs are
// derived from `["clear_wallet", creator, sha256(name)]`. Callers
// arriving via a URL (`/app/wallet/Family#abc123`) have the name but
// not the creator, so `fetchWalletByName` falls back to a getProgramAccounts
// scan with a name-match filter. When the creator is known (e.g. the
// connected user just created the wallet, or the caller pulled it
// from a memberships row), pass it via `fetchWalletByName` to use the
// fast PDA derivation path instead of the scan.

import { Connection, PublicKey } from "@solana/web3.js";
import {
  DISC_CLEAR_WALLET,
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

/// Fetch a wallet by its on-chain name. Two lookup paths:
///
///   1. Fast: caller passes `knownCreator` (extracted from a
///      memberships row, or = the connected user when they're the
///      one who just created it). Derives the PDA, single
///      `getAccountInfo` call.
///
///   2. Fallback: no `knownCreator`. We scan ClearWallet accounts
///      via `getProgramAccounts` with a discriminator filter and
///      pick the one whose `name` field equals the lookup name.
///      One RPC, slower; bounded by total wallets in the program.
///
/// Returns `null` when no account matches.
export async function fetchWalletByName(
  connection: Connection,
  name: string,
  knownCreator?: PublicKey,
): Promise<WalletWithPda | null> {
  if (knownCreator) {
    const [pda, bump] = findWalletAddress(name, knownCreator, CLEAR_WALLET_PROGRAM_ID);
    const info = await connection.getAccountInfo(pda, DEFAULT_COMMITMENT);
    if (!info) return null;
    const account = parseWallet(new Uint8Array(info.data));
    return { name, pda, bump, account };
  }

  // Fallback: scan all ClearWallet accounts and match by name.
  const accounts = await connection.getProgramAccounts(
    CLEAR_WALLET_PROGRAM_ID,
    {
      commitment: DEFAULT_COMMITMENT,
      filters: [{ memcmp: { offset: 0, bytes: bs58FromByte(DISC_CLEAR_WALLET) } }],
    },
  );
  for (const { pubkey, account: info } of accounts) {
    try {
      const parsed = parseWallet(new Uint8Array(info.data));
      if (parsed.name === name) {
        return { name, pda: pubkey, bump: parsed.bump, account: parsed };
      }
    } catch {
      // Account didn't parse as ClearWallet (discriminator mismatch
      // or layout drift). Skip and continue scanning - a corrupt row
      // shouldn't poison the whole lookup.
      continue;
    }
  }
  return null;
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

/// Encode a single byte as base58 - the format Solana RPC's memcmp
/// filter expects for byte-comparison. Stays tiny on purpose; for
/// arbitrary bytes use a real base58 encoder.
function bs58FromByte(b: number): string {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  // Single byte 0x00..0xff fits in at most 2 base58 chars.
  if (b === 0) return "1";
  let n = b;
  let out = "";
  while (n > 0) {
    out = ALPHABET[n % 58] + out;
    n = Math.floor(n / 58);
  }
  return out;
}
