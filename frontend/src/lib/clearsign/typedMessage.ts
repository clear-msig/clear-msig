import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { fromHex } from "@/lib/msig";
import { formatTimestamp } from "@/lib/msig/datetime";

const decoder = new TextDecoder("utf-8", { fatal: true });

export class TypedClearSignMessageVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypedClearSignMessageVerificationError";
  }
}

type VoteVerb = "propose" | "approve" | "cancel";

export interface ExpectedTypedClearSignMessage {
  envelopeHash: string;
  payloadHash: string;
  signableText: string;
}

const ACTION_TO_VOTE_VERB: Record<string, VoteVerb> = {
  proposal_typed_create: "propose",
  proposal_typed_approve: "approve",
  proposal_typed_cancel: "cancel",
  propose: "propose",
  approve: "approve",
  cancel: "cancel",
};

export function verifiedTypedClearSignMessageBytes(
  descriptor: TypedDryRunDescriptor,
  expected?: ExpectedTypedClearSignMessage,
): Uint8Array {
  if (
    descriptor.message_flavor !== "clearsign_v3_document" &&
    descriptor.message_flavor !== "clearsign_v2_text"
  ) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request has the wrong message flavor.",
    );
  }

  const bytes = fromHex(descriptor.message_hex);
  if (bytes.length === 0) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request is missing signable text.",
    );
  }

  let text: string;
  try {
    text = decoder.decode(bytes);
  } catch {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request is not readable UTF-8 text.",
    );
  }
  if (hasUnsafeControlCharacters(text)) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request contains unsafe control characters.",
    );
  }

  if (descriptor.message_flavor === "clearsign_v2_text") {
    verifyLegacyV2Approval(descriptor, text, expected);
    return bytes;
  }

  verifyTypedClearSignMessageText(descriptor, text);
  if (expected) {
    verifyExpectedTypedClearSignMessage(descriptor, text, expected);
  }
  return bytes;
}

function verifyLegacyV2Approval(
  descriptor: TypedDryRunDescriptor,
  text: string,
  expected?: ExpectedTypedClearSignMessage,
): void {
  const voteVerb = expectedVoteVerb(descriptor.action);
  if (voteVerb === "propose" || expected) {
    throw new TypedClearSignMessageVerificationError(
      "Legacy ClearSign v2 is restricted to existing proposal approvals and cancellations.",
    );
  }
  const prefix = `${[
    `ClearSign v2 ${voteVerb}`,
    `Wallet ${descriptor.wallet_name}`,
    `Proposal ${BigInt(descriptor.proposal_index).toString()}`,
    `Envelope ${normalizeHex(descriptor.envelope_hash_hex)}`,
  ].join("\n")}\n\n`;
  if (!text.startsWith(prefix)) {
    throw new TypedClearSignMessageVerificationError(
      "Legacy ClearSign approval does not match the stored proposal.",
    );
  }
  const clearText = text.slice(prefix.length);
  if (!clearText || new TextEncoder().encode(clearText).length > 2048) {
    throw new TypedClearSignMessageVerificationError(
      "Legacy ClearSign approval has invalid readable text.",
    );
  }
}

function hasUnsafeControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return (code < 0x20 && code !== 0x0a) || (code >= 0x7f && code <= 0x9f);
  });
}

function verifyExpectedTypedClearSignMessage(
  descriptor: TypedDryRunDescriptor,
  text: string,
  expected: ExpectedTypedClearSignMessage,
): void {
  const split = text.indexOf("\n\nAPPROVAL\n");
  const body = split < 0 ? "" : text.slice(0, split);
  if (
    normalizeHex(descriptor.envelope_hash_hex) !== normalizeHex(expected.envelopeHash) ||
    normalizeHex(descriptor.payload_hash_hex) !== normalizeHex(expected.payloadHash) ||
    body !== expected.signableText
  ) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request does not match the transaction reviewed in this browser.",
    );
  }
}

export function verifyTypedClearSignMessageText(
  descriptor: TypedDryRunDescriptor,
  text: string,
): void {
  const split = text.indexOf("\n\nAPPROVAL\n");
  if (split < 0) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request is missing readable action details.",
    );
  }

  const body = text.slice(0, split);
  const approval = text.slice(split + 2);
  const voteVerb = expectedVoteVerb(descriptor.action);
  verifyApprovalContext(descriptor, voteVerb);

  const expectedApproval = [
    "APPROVAL",
    `Decision: ${voteVerb.toUpperCase()}`,
    `Proposal: #${BigInt(descriptor.proposal_index).toString()}`,
    `Wallet: ${descriptor.wallet_name}`,
    `Requested by: ${descriptor.signer_pubkey}`,
    `Requirement: ${descriptor.approval_requirement} ${approvalRequirementLabel(descriptor)}`,
    `Status if accepted: ${descriptor.approval_count_after} of ${descriptor.approval_requirement} ${approvalRequirementLabel(descriptor)}`,
    "",
    "EXPIRY",
    `${formatTimestamp(descriptor.expiry)} UTC`,
    "",
    "PROOF",
    "ClearSign: v3",
    `Envelope: ${normalizeHex(descriptor.envelope_hash_hex)}`,
  ].join("\n");
  if (normalizeEnvelopeProof(approval) !== expectedApproval) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign approval or proof does not match the prepared request.",
    );
  }

  const sections = body.split("\n\n");
  const expectedSections = [
    "ClearSig Proposal",
    "ACTION",
    "DETAILS",
    "POLICY",
    "RISK",
    "PURPOSE",
  ];
  if (sections.length !== expectedSections.length) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request has duplicate or unexpected document sections.",
    );
  }
  for (const [index, section] of sections.entries()) {
    const expected = expectedSections[index];
    if (
      (index === 0 && section !== expected) ||
      (index > 0 && !section.startsWith(`${expected}\n`)) ||
      (index > 0 && section.length === expected.length + 1)
    ) {
      throw new TypedClearSignMessageVerificationError(
        `Typed ClearSign request has an invalid ${expected} section.`,
      );
    }
  }
  const policyLines = sections[3].split("\n").slice(1);
  const profiles = [
    "Display profile: clearsig-full-v1@1",
    "Display profile: clearsig-ledger-solana-v1@1",
  ];
  const profileCount = profiles.reduce(
    (count, profile) =>
      count + text.split(profile).length - 1,
    0,
  );
  if (
    profileCount !== 1 ||
    !profiles.some((profile) => policyLines.includes(profile))
  ) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request does not use a registered display profile.",
    );
  }
}

function verifyApprovalContext(
  descriptor: TypedDryRunDescriptor,
  voteVerb: VoteVerb,
): void {
  const requirement = descriptor.approval_requirement;
  const after = descriptor.approval_count_after;
  const expectedKind = voteVerb === "cancel" ? "cancellations" : "approvals";
  if (
    !Number.isSafeInteger(requirement) ||
    requirement < 1 ||
    requirement > 16 ||
    !Number.isSafeInteger(after) ||
    after < 0 ||
    after > requirement ||
    descriptor.approval_kind !== expectedKind
  ) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request has invalid approval requirements.",
    );
  }
}

function approvalRequirementLabel(descriptor: TypedDryRunDescriptor): string {
  const singular = descriptor.approval_requirement === 1;
  if (descriptor.approval_kind === "cancellations") {
    return singular ? "cancellation" : "cancellations";
  }
  return singular ? "approval" : "approvals";
}

function expectedVoteVerb(action: string): VoteVerb {
  const verb = ACTION_TO_VOTE_VERB[action];
  if (!verb) {
    throw new TypedClearSignMessageVerificationError(
      `Typed ClearSign action ${JSON.stringify(action)} is not supported.`,
    );
  }
  return verb;
}

function normalizeEnvelopeProof(value: string): string {
  return value.replace(
    /(^|\n)Envelope: (?:0x)?([0-9a-fA-F]{64})$/,
    (_match, prefix: string, hash: string) => `${prefix}Envelope: ${hash.toLowerCase()}`,
  );
}

function normalizeHex(value: string): string {
  return value.trim().replace(/^0x/i, "").toLowerCase();
}
