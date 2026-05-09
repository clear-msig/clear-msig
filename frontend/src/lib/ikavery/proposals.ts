// Per-recovery proposal listing.
//
// The Recovery account stores `proposalCount`, the next index. Each
// Proposal lives at `proposalPda(recovery, i)` for i in 0..count-1.
// `listProposals` derives those addresses, batch-fetches them via
// `getMultipleAccountsInfo`, and decodes whatever's there. Missing
// rows (proposals that were cancelled / never created) are dropped.

import { Connection, PublicKey } from "@solana/web3.js";

import { decodeProposal, type ProposalAccount } from "./codec/proposal";
import { proposalPda } from "./pda";

export interface ProposalEntry {
  proposal: PublicKey;
  account: ProposalAccount;
}

/**
 * List all proposals for a recovery, newest first.
 *
 * `proposalCount` should be the value read off the Recovery account;
 * we don't re-fetch it here so the caller can decide when to revalidate.
 * Returns at most `count` entries (skips any addresses that don't
 * decode, so the result may be shorter on a vault with cancelled
 * proposals).
 */
export async function listProposals(
  connection: Connection,
  recovery: PublicKey,
  proposalCount: number,
): Promise<ProposalEntry[]> {
  if (proposalCount <= 0) return [];
  const addresses: PublicKey[] = [];
  for (let i = 0; i < proposalCount; i++) {
    addresses.push(proposalPda(recovery, i));
  }
  const infos = await connection.getMultipleAccountsInfo(addresses, "confirmed");
  const out: ProposalEntry[] = [];
  for (let i = 0; i < addresses.length; i++) {
    const info = infos[i];
    if (!info || info.data.length === 0) continue;
    try {
      const account = decodeProposal(new Uint8Array(info.data));
      out.push({ proposal: addresses[i]!, account });
    } catch {
      /* corrupt / wrong-disc — skip */
    }
  }
  // Newest first — proposalIndex monotonically increases on chain.
  return out.sort(
    (a, b) => b.account.proposalIndex - a.account.proposalIndex,
  );
}
