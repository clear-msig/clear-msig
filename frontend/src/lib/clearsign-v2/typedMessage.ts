import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { fromHex } from "@/lib/msig";

const decoder = new TextDecoder("utf-8", { fatal: true });

export class TypedClearSignMessageVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypedClearSignMessageVerificationError";
  }
}

type VoteVerb = "propose" | "approve" | "cancel";

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
): Uint8Array {
  if (descriptor.message_flavor !== "clearsign_v2_text") {
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

  verifyTypedClearSignMessageText(descriptor, text);
  return bytes;
}

export function verifyTypedClearSignMessageText(
  descriptor: TypedDryRunDescriptor,
  text: string,
): void {
  const split = text.indexOf("\n\n");
  if (split < 0) {
    throw new TypedClearSignMessageVerificationError(
      "Typed ClearSign request is missing readable action details.",
    );
  }

  const header = text.slice(0, split).split("\n");
  const body = text.slice(split + 2);
  const voteVerb = expectedVoteVerb(descriptor.action);

  expectLine(header[0], `ClearSign v2 ${voteVerb}`, "vote type");
  expectLine(header[1], `Wallet ${descriptor.wallet_name}`, "wallet name");
  expectLine(
    header[2],
    `Proposal ${BigInt(descriptor.proposal_index).toString()}`,
    "proposal index",
  );
  expectLine(
    normalizeEnvelopeLine(header[3]),
    `Envelope ${normalizeHex(descriptor.envelope_hash_hex)}`,
    "envelope hash",
  );

  const requiredBodyParts = [
    `Wallet ${descriptor.wallet_name}`,
    `Action ${descriptor.action_id}`,
    `Nonce ${descriptor.nonce}`,
    `Payload ${normalizeHex(descriptor.payload_hash_hex)}`,
  ];
  for (const part of requiredBodyParts) {
    if (!body.includes(part)) {
      throw new TypedClearSignMessageVerificationError(
        `Typed ClearSign request is missing ${part}.`,
      );
    }
  }
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

function expectLine(
  actual: string | undefined,
  expected: string,
  field: string,
): void {
  if (actual !== expected) {
    throw new TypedClearSignMessageVerificationError(
      `Typed ClearSign ${field} does not match the prepared request.`,
    );
  }
}

function normalizeEnvelopeLine(line: string | undefined): string | undefined {
  if (!line?.startsWith("Envelope ")) return line;
  return `Envelope ${normalizeHex(line.slice("Envelope ".length))}`;
}

function normalizeHex(value: string): string {
  return value.trim().replace(/^0x/i, "").toLowerCase();
}
