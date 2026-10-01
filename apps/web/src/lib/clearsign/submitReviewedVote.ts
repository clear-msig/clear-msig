import { requestRecovery } from "./requestRecovery";
import type { CancellationContext } from "./cancellationReview";
import {
  submittedVoteTxid,
  voteContextHash,
  voteIsRecorded,
  type RequestVote,
  type VoteOutcome,
} from "./voteEvidence";
/** Submission acknowledgement and finalized actor vote are distinct evidence. */
export async function submitReviewedVote(input: {
  context: CancellationContext;
  actor: string;
  vote: RequestVote;
  endpoint: string;
  accountKey: string;
  submit: () => Promise<unknown>;
  read: () => Promise<CancellationContext | null>;
  assertCurrent: () => void;
}): Promise<VoteOutcome> {
  const { context, actor, vote } = input;
  input.assertCurrent();
  if (requestRecovery.voteFor(input.endpoint, context.address, actor))
    throw new Error(
      "A vote by this member may already have been submitted. Check the existing request before voting again.",
    );
  const hash = voteContextHash(context);
  const recovery = requestRecovery.begin({
    walletName: context.walletName,
    endpoint: input.endpoint,
    accountKey: input.accountKey,
    label: vote === "approve" ? "Approval vote" : "Cancellation vote",
    identity: ["vote", context.address, actor, vote],
    phase: "vote",
    actor,
    vote,
    voteContext: hash,
  });
  const outcome: VoteOutcome = {
    state: "unknown",
    proposal: context.address,
    actor,
    vote,
  };
  try {
    recovery.submitting(context.address);
    let txid: string | undefined;
    try {
      txid = submittedVoteTxid(await input.submit(), context, actor, vote);
      recovery.accepted(context.address, txid);
    } catch {
      /* missing/malformed/failed response never means vote recorded */
    }
    input.assertCurrent();
    if (!txid) return outcome;
    let current: CancellationContext | null = null;
    try {
      current = await input.read();
    } catch {
      /* confirmed RPC may lag */
    }
    input.assertCurrent();
    const confirmed =
      current !== null && voteIsRecorded(current, hash, actor, vote);
    if (confirmed) recovery.complete();
    return { ...outcome, state: confirmed ? "confirmed" : "submitted", txid };
  } finally {
    recovery.finish();
  }
}
