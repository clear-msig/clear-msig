"use client";

// approveIfNeeded - fetch the proposal's current status and decide
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
//
// Polling: Solana RPCs replicate state across slots; the backend
// can return success on its own RPC node before the frontend's RPC
// node has caught up. Reading a fresh proposal account may briefly
// return null. Retry with a short backoff so we don't fire a
// spurious second popup just because the read replica was a slot
// behind. After exhausting retries with `null`, we trust the
// program's auto-approve and skip the second sign - the alternative
// (default-to-needs-approve) was producing a duplicate wallet popup
// in production.

import { Connection, PublicKey } from "@solana/web3.js";
import { fetchProposal } from "@/lib/chain/proposals";
import { ProposalStatus } from "@/lib/msig";

export interface ApproveDecision {
  /// When true, caller should run their prepare-approve / sign /
  /// submit-approve dance. When false, the proposal is already in
  /// Approved state and the caller goes straight to execute.
  needsApproveSignature: boolean;
  /// Status as observed on chain. `null` when we couldn't read.
  status: ProposalStatus | null;
}

export interface ApproveIfNeededOptions {
  approvers?: readonly string[];
  approverPubkey?: string | null;
  approvalThreshold?: number | null;
}

const POLL_ATTEMPTS = 4;
const POLL_DELAY_MS = 300;

export async function approveIfNeeded(
  connection: Connection,
  proposalPda: string,
  options: ApproveIfNeededOptions = {},
): Promise<ApproveDecision> {
  if (!proposalPda) {
    return { needsApproveSignature: true, status: null };
  }

  let lastReadError: unknown = null;
  for (let i = 0; i < POLL_ATTEMPTS; i++) {
    try {
      const account = await fetchProposal(
        connection,
        new PublicKey(proposalPda),
      );
      if (account) {
        if (
          account.status === ProposalStatus.Active &&
          options.approverPubkey &&
          options.approvers
        ) {
          const approverIndex = options.approvers.indexOf(options.approverPubkey);
          if (
            approverIndex >= 0 &&
            approverIndex < 16 &&
            (account.approvalBitmap & (1 << approverIndex)) !== 0
          ) {
            return {
              needsApproveSignature: false,
              status: account.status,
            };
          }
        }
        return {
          needsApproveSignature: account.status !== ProposalStatus.Approved,
          status: account.status,
        };
      }
      // Account not visible yet (read replica lag). Backoff and retry.
    } catch (err) {
      lastReadError = err;
      // Read errored (network, RPC). Same retry path.
    }
    if (i < POLL_ATTEMPTS - 1) {
      await sleep(POLL_DELAY_MS * (i + 1));
    }
  }

  // Exhausted retries.
  //
  // If we hit a read error every time, conservatively keep the
  // legacy approve path - the chain might genuinely be unreachable
  // and a missed read shouldn't cause us to skip a real approval
  // step.
  //
  // If reads succeeded but the account was null every time, the
  // submit returned 200 (so propose committed) but we can't see
  // the account. This is a frontend-RPC consistency lag, not a
  // status issue. Trust the program's auto-approve - the
  // alternative was firing a duplicate wallet popup for every
  // submit when the user's RPC was a slot behind the backend's.
  return {
    needsApproveSignature:
      lastReadError !== null || (options.approvalThreshold ?? 1) > 1,
    status: null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
