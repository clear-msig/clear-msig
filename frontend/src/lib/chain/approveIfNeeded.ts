"use client";

// approveIfNeeded — fetch the proposal's current status and decide
// whether the explicit approve+execute pair is still needed, or if
// the proposal already landed Approved (program-side auto-approve
// when the proposer sits in the approver list).
//
// The on-chain `propose` instruction was updated to flip the
// proposer's bit in `approval_bitmap` inline; if that bit alone
// meets `approval_threshold` (the common 1-of-1 case, plus any
// wallet where the proposer also approves), the proposal lands in
// the `Approved` state directly. This helper lets every signed
// write path stay forward- AND backward-compatible:
//
//   - Old program (no auto-approve) → proposal is Active → caller
//     does the explicit approve, then execute.
//   - New program (auto-approve)    → proposal is Approved → caller
//     skips approve, goes straight to execute. One fewer wallet popup.
//
// We pay one extra RPC read per propose for the privilege; that's
// cheap relative to the wallet-popup eliminated when the program
// is updated. Calls that don't carry a proposal address (legacy
// shapes) fall through to the always-explicit path.

import { Connection, PublicKey } from "@solana/web3.js";
import { fetchProposal } from "@/lib/chain/proposals";
import { ProposalStatus } from "@/lib/msig";

export interface ApproveDecision {
  /// When true, caller should run their prepare-approve / sign /
  /// submit-approve dance. When false, the proposal is already in
  /// Approved state and the caller goes straight to execute.
  needsApproveSignature: boolean;
  /// Status as observed on chain. `null` when we couldn't read
  /// (treat as needs-approve to be safe).
  status: ProposalStatus | null;
}

export async function approveIfNeeded(
  connection: Connection,
  proposalPda: string,
): Promise<ApproveDecision> {
  if (!proposalPda) {
    return { needsApproveSignature: true, status: null };
  }
  try {
    const account = await fetchProposal(
      connection,
      new PublicKey(proposalPda),
    );
    if (!account) {
      return { needsApproveSignature: true, status: null };
    }
    return {
      needsApproveSignature: account.status !== ProposalStatus.Approved,
      status: account.status,
    };
  } catch {
    // Conservatively keep the legacy approve path on read failures —
    // a missed read shouldn't block the user from completing the
    // mutation.
    return { needsApproveSignature: true, status: null };
  }
}
