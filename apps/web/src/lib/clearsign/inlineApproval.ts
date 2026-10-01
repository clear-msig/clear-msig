import { PublicKey } from "@solana/web3.js";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { findTypedProposalAddress } from "@/lib/msig/pda";
import { sha256 } from "@/lib/msig/hash";
import {
  verifiedTypedClearSignMessageBytes,
  type ExpectedTypedClearSignMessage,
} from "./typedMessage";

/** Only for this browser's just-created, independently reviewed canonical action.
 * Never derive `expected` from the approval response, or reuse it for another request.
 * Inbox approval uses the finalized account reader instead.
 */
export function inlineApprovalOptions(
  creation: TypedDryRunDescriptor,
  approval: TypedDryRunDescriptor,
  expected: ExpectedTypedClearSignMessage,
  proposalAddress: string,
  signer: PublicKey,
) {
  try {
    const derived = new PublicKey(
      reviewedCreationProposalAddress(creation, expected),
    );
    if (
      derived.toBase58() !== proposalAddress ||
      creation.proposal_pubkey !== proposalAddress ||
      approval.proposal_pubkey !== proposalAddress ||
      approval.action !== "proposal_typed_approve" ||
      approval.signer_pubkey !== signer.toBase58() ||
      approval.approval_kind !== "approvals"
    ) {
      throw new Error("Approval targets a different request or signer.");
    }
    for (const field of [
      "wallet_name",
      "wallet_pubkey",
      "intent_index",
      "intent_pubkey",
      "proposal_index",
      "action_kind",
      "policy_commitment_hex",
      "approval_requirement",
      "expiry",
      "message_flavor",
    ] as const) {
      if (approval[field] !== creation[field])
        throw new Error(`Approval changed ${field}.`);
    }
    // v4 stores replay labels as SHA-256 bytes. The current server exposes these
    // stored bytes with Rust's UTF-8-lossy conversion, not the original labels.
    const storedLabel = (label: string) =>
      new TextDecoder("utf-8", { ignoreBOM: true }).decode(
        sha256(new TextEncoder().encode(label)),
      );
    if (
      approval.action_id !== storedLabel(creation.action_id) ||
      approval.nonce !== storedLabel(creation.nonce)
    ) {
      throw new Error("Approval changed the canonical replay identity.");
    }
    verifiedTypedClearSignMessageBytes(approval, expected);
    return {
      preferSigner: signer,
      expectedTyped: {
        envelopeHash: expected.envelopeHash,
        payloadHash: expected.payloadHash,
        signableText: expected.signableText,
      },
    };
  } catch (cause) {
    throw savedProposalError(proposalAddress, cause);
  }
}

/** Retain accepted work in errors; callers must resume this proposal, not create again. */
export function savedProposalError(
  proposalAddress: string,
  cause: unknown,
  accepted = true,
): Error & { proposalAddress: string } {
  const detail =
    cause instanceof Error ? cause.message : "Approval could not complete.";
  return Object.assign(
    new Error(
      `Request ${proposalAddress} ${accepted ? "was already created" : "was submitted, but its outcome is uncertain"}. Open this request to continue; do not create it again. ${detail}`,
      { cause },
    ),
    {
      proposalAddress,
      __clearMsigExecuteFailedProposal: proposalAddress,
    },
  );
}

export function reviewedCreationProposalAddress(
  creation: TypedDryRunDescriptor,
  expected: ExpectedTypedClearSignMessage,
): string {
  verifiedTypedClearSignMessageBytes(creation, expected);
  if (
    creation.action !== "proposal_typed_create" ||
    creation.message_flavor !== "clearsign_v4_document" ||
    !Number.isSafeInteger(creation.proposal_index) ||
    creation.proposal_index < 0
  )
    throw new Error("Missing verified v4 creation context.");
  const [derived] = findTypedProposalAddress(
    new PublicKey(creation.intent_pubkey),
    BigInt(creation.proposal_index),
    CLEAR_WALLET_PROGRAM_ID,
  );
  if (creation.proposal_pubkey !== derived.toBase58())
    throw new Error(
      "Prepared proposal address differs from the derived canonical request.",
    );
  return derived.toBase58();
}

export function assertSubmittedCreation(
  creation: TypedDryRunDescriptor,
  expected: ExpectedTypedClearSignMessage,
  submittedAddress: unknown,
): string {
  const address = reviewedCreationProposalAddress(creation, expected);
  if (submittedAddress !== address)
    throw savedProposalError(
      address,
      new Error(
        "Submission returned a missing or different request address. Check the prepared request's status.",
      ),
      false,
    );
  return address;
}
