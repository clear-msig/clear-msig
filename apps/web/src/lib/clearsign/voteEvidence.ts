import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
import { sha256, toHex } from "@/lib/msig/hash";
import type { CancellationContext } from "./cancellationReview";
import type { CanonicalProposalReview } from "./proposalReview";
export type RequestVote = "approve" | "cancel";
export type VoteOutcome = {
  state: "confirmed" | "submitted" | "unknown";
  proposal: string;
  actor: string;
  vote: RequestVote;
  txid?: string;
};
/** Immutable authority identity, excluding mutable status/vote bitmaps. */
export function voteContextHash(context: CancellationContext): string {
  const { proposal, intent } = context;
  if (!context.chainIdentity)
    throw new Error("Vote network identity is unavailable.");
  return toHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify([
          context.chainIdentity,
          context.address,
          context.walletName,
          proposal.wallet,
          proposal.intent,
          proposal.proposalIndex.toString(),
          proposal.typed
            ? [
                proposal.actionKind,
                proposal.policyCommitment,
                proposal.payloadHash,
                proposal.envelopeHash,
                proposal.actionId,
                proposal.nonce,
                proposal.clearTextHex,
              ]
            : toHex(proposal.paramsData),
          intent.approvers,
          intent.approvalThreshold,
          intent.cancellationThreshold,
        ]),
      ),
    ),
  );
}
export function approvalContextMatches(
  review: CanonicalProposalReview,
  context: CancellationContext,
): boolean {
  const p = context.proposal,
    b = review.binding;
  return (
    p.typed === true &&
    context.address === review.proposalAddress &&
    p.wallet === b.wallet &&
    p.intent === b.intent &&
    p.proposalIndex === b.index &&
    p.envelopeHash === review.envelopeHash &&
    p.payloadHash === review.payloadHash &&
    p.approvalBitmap === b.approvalBitmap &&
    context.intent.approvalThreshold === review.threshold &&
    JSON.stringify(context.intent.approvers) === JSON.stringify(b.approvers)
  );
}
export function submittedVoteTxid(
  response: unknown,
  context: CancellationContext,
  actor: string,
  vote: RequestVote,
): string {
  const txid = solanaSubmissionTxid(response, { proposal: context.address });
  const result = response as Record<string, unknown>;
  const index = context.intent.approvers.indexOf(actor);
  const action = context.proposal.typed ? `typed_${vote}` : vote;
  if (index < 0 || result.action !== action || result.approver_index !== index)
    throw new Error("Vote submission evidence names another action or member.");
  return txid;
}
export function voteIsRecorded(
  context: CancellationContext,
  expectedHash: string,
  actor: string,
  vote: RequestVote,
): boolean {
  if (voteContextHash(context) !== expectedHash) return false;
  const index = context.intent.approvers.indexOf(actor);
  if (index < 0) return false;
  const recorded =
    vote === "approve"
      ? context.proposal.approvalBitmap
      : context.proposal.cancellationBitmap;
  const opposite =
    vote === "approve"
      ? context.proposal.cancellationBitmap
      : context.proposal.approvalBitmap;
  return (recorded & (1 << index)) !== 0 && (opposite & (1 << index)) === 0;
}
