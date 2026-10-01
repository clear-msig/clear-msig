import { PublicKey } from "@solana/web3.js";
import type { CanonicalProposalReview } from "./proposalReview";
import { solanaSubmissionTxid } from "@/lib/chain/executionEvidence";
import type { AnyProposalAccount, IntentAccount } from "@/lib/msig/accounts";
export type ExecutionKind = "governance" | "transfer" | "external" | "action";
export type ExecutionOutcome = {
  state: "submitted" | "confirmed" | "unknown";
  proposal: string;
  kind: ExecutionKind;
  txid?: string;
};
export function executionKind(
  proposal: AnyProposalAccount,
  intent: IntentAccount,
): ExecutionKind {
  if (
    proposal.typed &&
    [1, 2].includes(proposal.actionKind) &&
    intent.chainKind !== 0
  )
    return "external";
  if (proposal.typed)
    return [3, 4, 5, 6, 16].includes(proposal.actionKind)
      ? "governance"
      : [1, 2].includes(proposal.actionKind)
        ? "transfer"
        : "action";
  return intent.intentType <= 2
    ? "governance"
    : intent.chainKind !== 0
      ? "external"
      : "action";
}
export function verifiedExecutionSubmission(
  response: Record<string, unknown>,
  proposalAddress: string,
  proposal: AnyProposalAccount,
  intent: IntentAccount,
  native?: NativeSolExecution,
): string {
  const path = native
    ? "typed_sol_send"
    : proposal.typed
      ? [3, 4, 5].includes(proposal.actionKind)
        ? "typed_intent_governance"
        : "typed"
      : intent.intentType <= 2
        ? "meta-intent"
        : intent.chainKind === 0
          ? "custom-local"
          : "ika-dwallet";
  const txid = solanaSubmissionTxid(response, {
    proposal: proposalAddress,
    path,
    requireProposal: proposal.typed,
  });
  if (
    proposal.typed &&
    [3, 4, 5].includes(proposal.actionKind) &&
    response.action_kind !== proposal.actionKind
  )
    throw new Error("Execution response names a different governance action.");
  if (
    native &&
    (response.recipient !== native.recipient ||
      response.amount_lamports !== native.amountLamports)
  )
    throw new Error(
      "Execution response changed the native SOL amount or recipient.",
    );
  if (path === "ika-dwallet") {
    const broadcast = response.broadcast;
    if (
      response.chain_kind !== intent.chainKind ||
      !broadcast ||
      typeof broadcast !== "object"
    )
      throw new Error(
        "Destination broadcast evidence is missing or names a different chain.",
      );
    const value = broadcast as Record<string, unknown>;
    if (
      value.chain_kind !== intent.chainKind ||
      typeof value.tx_id !== "string" ||
      !(
        [1, 4, 5].includes(intent.chainKind)
          ? /^0x[0-9a-fA-F]{64}$/
          : /^[0-9a-fA-F]{64}$/
      ).test(value.tx_id)
    )
      throw new Error(
        "Destination broadcast transaction identity is malformed or mismatched.",
      );
  }
  return txid;
}
export function executionOutcomeLabel(outcome: ExecutionOutcome): string {
  if (outcome.kind === "external")
    return outcome.state === "confirmed"
      ? "Solana authorization recorded; destination status unverified"
      : outcome.state === "submitted"
        ? "Destination broadcast submitted; destination confirmation unverified"
        : "Execution outcome uncertain; destination status unverified";
  const subject =
    outcome.kind === "governance"
      ? "Governance change"
      : outcome.kind === "transfer"
        ? "Transfer"
        : "Request execution";
  return outcome.state === "confirmed"
    ? `${subject} confirmed on Solana`
    : outcome.state === "submitted"
      ? `${subject} submitted; verification pending`
      : "Execution outcome uncertain; check the existing request";
}

export type NativeSolExecution = { recipient: string; amountLamports: number };
export function nativeSolExecutionFromReview(
  review: CanonicalProposalReview,
  chainKind: number,
): NativeSolExecution {
  if (
    chainKind !== 0 ||
    review.binding.actionKind !== 1 ||
    review.network !== "Solana Devnet"
  )
    throw new Error(
      "This request is not a verified native SOL transfer on the supported network.",
    );
  const details = review.sections.find((s) => s.title === "DETAILS")?.text;
  if (!details || /^Asset(?: ID| mint)?:/m.test(details))
    throw new Error(
      "This asset requires a separate action-specific recovery executor.",
    );
  const amounts = details.match(/^Amount: (.+) SOL$/gm),
    destinations = details.match(/^To: (.+)$/gm);
  if (amounts?.length !== 1 || destinations?.length !== 1)
    throw new Error("Native SOL transfer details are missing or ambiguous.");
  const decimal = amounts[0].slice(8, -4);
  if (
    !/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(decimal) ||
    review.headline !== `Send ${decimal} SOL`
  )
    throw new Error("Native SOL amount or action label is not exact.");
  const [whole, fraction = ""] = decimal.split(".");
  const amount =
    BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, "0"));
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(
      "Native SOL amount is outside the exact range supported by this executor API.",
    );
  const recipient = destinations[0].slice(4);
  if (new PublicKey(recipient).toBase58() !== recipient)
    throw new Error("Native SOL destination is not a canonical address.");
  return { recipient, amountLamports: Number(amount) };
}

/** Explains route capability before offering a consequential execution action. */
export function proposalExecutionUnavailable(
  proposal: AnyProposalAccount,
  intent: IntentAccount,
  review: CanonicalProposalReview | undefined,
  checking: boolean,
  failed: boolean,
): string | null {
  let executionUnavailable: string | null = null;
  if (proposal.typed && ![3, 4, 5].includes(proposal.actionKind)) {
    if (proposal.actionKind !== 1 || intent.chainKind !== 0) {
      executionUnavailable =
        "This action requires an action-specific recovery executor that is not available on this page. No execution has been submitted here. You can still review this request or vote to cancel it.";
    } else if (checking || !review) {
      executionUnavailable = failed
        ? "Native SOL execution requires a complete verified action review. Resolve the review error above first."
        : "Waiting for the verified native SOL action details before execution.";
    } else {
      try {
        nativeSolExecutionFromReview(review, intent.chainKind);
      } catch (error) {
        executionUnavailable =
          error instanceof Error
            ? error.message
            : "This native SOL action could not be verified.";
      }
    }
  }
  return executionUnavailable;
}
