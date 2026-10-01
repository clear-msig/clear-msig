import type { PublicKey } from "@solana/web3.js";

/** Select only members who have not already cast this particular vote.
 * Opposite votes remain eligible: the program replaces the member's prior vote.
 */
export function unvotedMembers(
  approvers: readonly string[],
  bitmap: number,
): string[] {
  return approvers.filter((_, index) => (bitmap & (1 << index)) === 0);
}

export function proposalVoterState(
  approvers: readonly string[],
  approvalBitmap: number,
  cancellationBitmap: number,
  pickSigner: (members: readonly string[]) => PublicKey | null,
) {
  const member = pickSigner(approvers);
  const approver = pickSigner(unvotedMembers(approvers, approvalBitmap));
  const canceller = pickSigner(unvotedMembers(approvers, cancellationBitmap));
  return { member, approver, canceller };
}
