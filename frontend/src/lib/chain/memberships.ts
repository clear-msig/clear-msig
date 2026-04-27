// Direct-RPC membership scan.
//
// Replaces the backend's `GET /memberships` with two memcmp-filtered
// `getProgramAccounts` calls . one for wallets (disc=1), one for
// intents (disc=2). Filtering by discriminator server-side shrinks the
// response from every program account to just the ones we actually
// iterate over.
//
// The frontend stays usable even if the backend is down: the browser
// connects to Solana directly and computes memberships locally.

import bs58 from "bs58";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  DISC_CLEAR_WALLET,
  DISC_INTENT,
  parseIntent,
  parseWallet,
  type IntentAccount,
  type WalletAccount,
} from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";

/// One membership entry per wallet-the-address-belongs-to.
/// Shape mirrors the backend response so existing UI consumers
/// (`MyOrganizationsCard`, `fetchOnchainMemberships`) keep working.
export interface OnchainMembership {
  wallet: string;
  wallet_name?: string;
  roles: string[]; // subset of ["proposer", "approver"]
  intent_indexes: number[]; // sorted ascending
}

/// Scan every ClearWallet + Intent account under the clear-wallet
/// program and return the wallets where `address` appears as a
/// proposer or approver on any intent.
export async function listMemberships(
  connection: Connection,
  address: string
): Promise<OnchainMembership[]> {
  const [walletInfos, intentInfos] = await Promise.all([
    fetchByDiscriminator(connection, DISC_CLEAR_WALLET),
    fetchByDiscriminator(connection, DISC_INTENT),
  ]);

  // Parse wallets first so we can label each entry with its human name.
  const walletNames = new Map<string, string>();
  for (const entry of walletInfos) {
    let parsed: WalletAccount;
    try {
      parsed = parseWallet(entry.data);
    } catch {
      continue;
    }
    walletNames.set(entry.pubkey, parsed.name);
  }

  // Accumulator keyed on the intent's `wallet` field (which points back
  // at the owning ClearWallet's PDA).
  const byWallet = new Map<
    string,
    {
      walletName?: string;
      hasProposer: boolean;
      hasApprover: boolean;
      intentIndexes: Set<number>;
    }
  >();

  for (const entry of intentInfos) {
    let intent: IntentAccount;
    try {
      intent = parseIntent(entry.data);
    } catch {
      continue;
    }
    const isProposer = intent.proposers.includes(address);
    const isApprover = intent.approvers.includes(address);
    if (!isProposer && !isApprover) continue;

    const acc =
      byWallet.get(intent.wallet) ??
      {
        walletName: walletNames.get(intent.wallet),
        hasProposer: false,
        hasApprover: false,
        intentIndexes: new Set<number>(),
      };
    if (isProposer) acc.hasProposer = true;
    if (isApprover) acc.hasApprover = true;
    acc.intentIndexes.add(intent.intentIndex);
    byWallet.set(intent.wallet, acc);
  }

  const out: OnchainMembership[] = [];
  for (const [wallet, acc] of byWallet) {
    const roles: string[] = [];
    if (acc.hasProposer) roles.push("proposer");
    if (acc.hasApprover) roles.push("approver");
    const intentIndexes = Array.from(acc.intentIndexes).sort((a, b) => a - b);
    out.push({
      wallet,
      wallet_name: acc.walletName,
      roles,
      intent_indexes: intentIndexes,
    });
  }
  // Stable ordering . by wallet PDA string, matches backend behaviour.
  out.sort((a, b) => a.wallet.localeCompare(b.wallet));
  return out;
}

// ── internals ─────────────────────────────────────────────────────────

interface RawAccount {
  pubkey: string;
  data: Uint8Array;
}

async function fetchByDiscriminator(
  connection: Connection,
  discriminator: number
): Promise<RawAccount[]> {
  const filter = {
    memcmp: {
      offset: 0,
      bytes: bs58.encode(new Uint8Array([discriminator])),
    },
  };
  const raw = await connection.getProgramAccounts(
    CLEAR_WALLET_PROGRAM_ID,
    {
      commitment: DEFAULT_COMMITMENT,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      filters: [filter as any],
    }
  );
  return raw.map((r) => ({
    pubkey: r.pubkey.toBase58(),
    data: new Uint8Array(r.account.data),
  }));
}
