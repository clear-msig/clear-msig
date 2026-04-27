// Direct-RPC intent reader.
//
// The wallet tracks its highest-allocated intent index in
// `walletAccount.intentIndex`. Every intent index from 0..=intentIndex
// has a PDA; some of them may be deactivated (disc=2 account with
// approved byte = 0) but the account still exists. We derive every PDA,
// batch-fetch with `getMultipleAccountsInfo` (one RPC roundtrip for up
// to 100 keys), and parse what comes back.

import { Connection, PublicKey } from "@solana/web3.js";
import {
  findIntentAddress,
  parseIntent,
  type IntentAccount,
} from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";

export interface IntentWithPda {
  pda: PublicKey;
  index: number;
  account: IntentAccount | null;
}

/// Fetch every intent from 0..=`upToIndex` in one batched RPC call.
/// Entries with no account (removed or not yet created) return with
/// `account: null` so the UI can render a greyed-out row.
export async function listIntents(
  connection: Connection,
  wallet: PublicKey,
  upToIndex: number
): Promise<IntentWithPda[]> {
  const pdas: { pda: PublicKey; index: number }[] = [];
  for (let i = 0; i <= upToIndex; i++) {
    const [pda] = findIntentAddress(wallet, i, CLEAR_WALLET_PROGRAM_ID);
    pdas.push({ pda, index: i });
  }

  // `getMultipleAccountsInfo` allows up to 100 keys per call; slice
  // defensively in case a future wallet overflows.
  const accounts = await getMultipleAccountsBatched(
    connection,
    pdas.map((p) => p.pda)
  );

  return pdas.map((p, i) => {
    const info = accounts[i];
    if (!info) return { pda: p.pda, index: p.index, account: null };
    try {
      return { pda: p.pda, index: p.index, account: parseIntent(new Uint8Array(info.data)) };
    } catch {
      // Wrong discriminator / corrupted data . surface as null so the UI
      // skips this row instead of crashing the list.
      return { pda: p.pda, index: p.index, account: null };
    }
  });
}

/// Fetch a single intent by wallet + index.
export async function fetchIntent(
  connection: Connection,
  wallet: PublicKey,
  index: number
): Promise<IntentWithPda> {
  const [pda] = findIntentAddress(wallet, index, CLEAR_WALLET_PROGRAM_ID);
  const info = await connection.getAccountInfo(pda, DEFAULT_COMMITMENT);
  return {
    pda,
    index,
    account: info ? parseIntent(new Uint8Array(info.data)) : null,
  };
}

// ── internals ─────────────────────────────────────────────────────────

async function getMultipleAccountsBatched(
  connection: Connection,
  pdas: PublicKey[]
) {
  const CHUNK = 100;
  if (pdas.length <= CHUNK) {
    return connection.getMultipleAccountsInfo(pdas, DEFAULT_COMMITMENT);
  }
  const out: Awaited<ReturnType<typeof connection.getMultipleAccountsInfo>> = [];
  for (let i = 0; i < pdas.length; i += CHUNK) {
    const chunk = pdas.slice(i, i + CHUNK);
    const page = await connection.getMultipleAccountsInfo(chunk, DEFAULT_COMMITMENT);
    out.push(...page);
  }
  return out;
}
