// Direct-RPC proposal reader.
//
// Two shapes:
//   - `fetchProposal(connection, pda)` . single read; used by the
//     proposal-detail page.
//   - `listProposalsForWallet(connection, wallet, walletAccount)` .
//     scans (intent_index × proposal_index) for every combination up to
//     the wallet's high-water marks, batching `getMultipleAccountsInfo`.
//
// The wallet account tracks the monotonic `proposalIndex`; the on-chain
// program allocates a new proposal at `(intent, current_proposal_index)`
// then increments the wallet's counter. So any proposal ever created
// has an index in `0..walletAccount.proposalIndex`.
//
// For most wallets this scan is small (dozens of (intent, proposal)
// pairs). If scale ever becomes an issue we'll switch to a
// `getProgramAccounts` filter on disc=3 + wallet==X, but that's a
// heavier query and overkill at hackathon scale.

import { Connection, PublicKey } from "@solana/web3.js";
import {
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

/// List every proposal ever created for this wallet. The scan space is
/// `(intent_index, proposal_index) ∈ [0, wallet.intentIndex] × [0, wallet.proposalIndex)`.
/// PDAs that don't exist on chain (wrong pairing . the proposal was
/// allocated under a different intent) return null and are filtered
/// out; the rest come back parsed.
export async function listProposalsForWallet(
  connection: Connection,
  wallet: PublicKey,
  walletAccount: Pick<WalletAccount, "intentIndex" | "proposalIndex">
): Promise<ProposalWithPda[]> {
  const { intentIndex, proposalIndex } = walletAccount;
  if (proposalIndex === 0n) return [];

  const pdaRows: { pda: PublicKey; intentIndex: number; proposalIndex: bigint }[] = [];
  for (let i = 0; i <= intentIndex; i++) {
    const [intentPda] = findIntentAddress(wallet, i, CLEAR_WALLET_PROGRAM_ID);
    // Proposal index is a u64 monotonic counter on the wallet . not per
    // intent . so we still iterate over every value in [0, proposalIndex)
    // and check which (intent, index) pair actually landed on chain.
    for (let p = 0n; p < proposalIndex; p++) {
      const [pda] = findProposalAddress(intentPda, p, CLEAR_WALLET_PROGRAM_ID);
      pdaRows.push({ pda, intentIndex: i, proposalIndex: p });
      const [typedPda] = findTypedProposalAddress(intentPda, p, CLEAR_WALLET_PROGRAM_ID);
      pdaRows.push({ pda: typedPda, intentIndex: i, proposalIndex: p });
    }
  }

  const accounts = await getMultipleAccountsBatched(
    connection,
    pdaRows.map((r) => r.pda)
  );

  const out: ProposalWithPda[] = [];
  for (let i = 0; i < pdaRows.length; i++) {
    const info = accounts[i];
    if (!info) continue;
    try {
      out.push({
        pda: pdaRows[i].pda,
        intentIndex: pdaRows[i].intentIndex,
        proposalIndex: pdaRows[i].proposalIndex,
        account: parseAnyProposal(new Uint8Array(info.data)),
      });
    } catch {
      // Wrong discriminator . PDA collision with another account type.
      // Skip silently; the real proposal will show up on its correct
      // (intent, index) pair.
    }
  }
  return out;
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
