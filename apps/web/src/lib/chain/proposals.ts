// Direct-RPC proposal reader. List only existing proposal accounts, filtered
// by discriminator and wallet. This avoids deriving the Cartesian product of
// every intent and every historical proposal index on each activity refresh.

import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import {
  DISC_PROPOSAL,
  DISC_TYPED_PROPOSAL,
  findIntentAddress,
  findProposalAddress,
  findTypedProposalAddress,
  parseAnyProposal,
  type AnyProposalAccount,
  type WalletAccount,
  ProposalStatus,
} from "@/lib/msig";
import { CLEAR_WALLET_PROGRAM_ID, DEFAULT_COMMITMENT } from "@/lib/chain/client";

export interface ProposalWithPda {
  pda: PublicKey;
  intentIndex: number;
  proposalIndex: bigint;
  account: AnyProposalAccount;
}

export async function fetchProposal(
  connection: Connection,
  pda: PublicKey
): Promise<AnyProposalAccount | null> {
  const info = await connection.getAccountInfo(pda, DEFAULT_COMMITMENT);
  if (!info) return null;
  return parseAnyProposal(new Uint8Array(info.data));
}

export interface ProposalStatusPollOptions {
  attempts?: number;
  delayMs?: number;
  accepted?: readonly ProposalStatus[];
}

export async function waitForProposalStatus(
  connection: Connection,
  proposalPda: string,
  options: ProposalStatusPollOptions = {},
): Promise<ProposalStatus | null> {
  const attempts = options.attempts ?? 6;
  const delayMs = options.delayMs ?? 350;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const proposal = await fetchProposal(connection, new PublicKey(proposalPda));
      if (
        proposal &&
        (!options.accepted || options.accepted.includes(proposal.status))
      ) {
        return proposal.status;
      }
      if (
        proposal &&
        (proposal.status === ProposalStatus.Cancelled ||
          proposal.status === ProposalStatus.Executed)
      ) {
        return proposal.status;
      }
    } catch {
      // RPC read lag must never be interpreted as approval.
    }
    if (attempt < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs * (attempt + 1)));
    }
  }
  return null;
}

export function proposalIsApproved(status: ProposalStatus | null): boolean {
  return status === ProposalStatus.Approved;
}

export async function waitForProposalApproval(
  connection: Connection,
  proposalPda: string,
  options: Omit<ProposalStatusPollOptions, "accepted"> = {},
): Promise<boolean> {
  const status = await waitForProposalStatus(connection, proposalPda, {
    ...options,
    accepted: [ProposalStatus.Approved],
  });
  return proposalIsApproved(status);
}

/// List existing legacy and typed proposals for this wallet snapshot. RPC
/// filters reduce transfer volume; validate the returned account bindings too
/// rather than trusting a provider to have applied those filters correctly.
export async function listProposalsForWallet(
  connection: Connection,
  wallet: PublicKey,
  walletAccount: Pick<WalletAccount, "intentIndex" | "proposalIndex">
): Promise<ProposalWithPda[]> {
  const { intentIndex, proposalIndex } = walletAccount;
  if (proposalIndex === 0n) return [];
  if (!Number.isInteger(intentIndex) || intentIndex < 0 || intentIndex > 255 ||
      proposalIndex < 0n || proposalIndex > 0xffffffffffffffffn) {
    throw new Error("Invalid wallet proposal counters.");
  }

  // Intent indices are u8, so this work is bounded independently of history.
  const intentIndices = new Map<string, number>();
  for (let i = 0; i <= intentIndex; i++) {
    const [intentPda] = findIntentAddress(wallet, i, CLEAR_WALLET_PROGRAM_ID);
    intentIndices.set(intentPda.toBase58(), i);
  }
  const walletAddress = wallet.toBase58();
  const pages = await Promise.all(
    [DISC_PROPOSAL, DISC_TYPED_PROPOSAL].map((discriminator) =>
      connection.getProgramAccounts(CLEAR_WALLET_PROGRAM_ID, {
        commitment: DEFAULT_COMMITMENT,
        filters: [
          { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.of(discriminator)) } },
          { memcmp: { offset: 1, bytes: walletAddress } },
        ],
      }),
    ),
  );

  const out: ProposalWithPda[] = [];
  const seen = new Set<string>();
  for (const { pubkey, account: info } of pages.flat()) {
    if (!info.owner.equals(CLEAR_WALLET_PROGRAM_ID)) continue;
    try {
      const account = parseAnyProposal(new Uint8Array(info.data));
      const index = intentIndices.get(account.intent);
      if (account.wallet !== walletAddress || index === undefined ||
          account.proposalIndex >= proposalIndex) continue;
      const [expected] = (account.typed ? findTypedProposalAddress : findProposalAddress)(
        new PublicKey(account.intent), account.proposalIndex, CLEAR_WALLET_PROGRAM_ID,
      );
      const address = pubkey.toBase58();
      if (!expected.equals(pubkey) || seen.has(address)) continue;
      seen.add(address);
      out.push({ pda: pubkey, intentIndex: index, proposalIndex: account.proposalIndex, account });
    } catch {
      // A malformed account must not poison the rest of the activity feed.
    }
  }
  // Preserve the previous intent/index/legacy-before-typed enumeration order.
  return out.sort((a, b) => a.intentIndex - b.intentIndex ||
    (a.proposalIndex < b.proposalIndex ? -1 : a.proposalIndex > b.proposalIndex ? 1 :
      Number(a.account.typed) - Number(b.account.typed)));
}
