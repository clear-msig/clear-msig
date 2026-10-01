import bs58 from "bs58";
/** Submission evidence only: shape/context checks do not prove confirmation or finality. */
export function solanaSubmissionTxid(
  response: unknown,
  expected: {
    proposal?: string;
    path?: string;
    requireProposal?: boolean;
  } = {},
): string {
  if (!response || typeof response !== "object" || Array.isArray(response))
    throw new Error(
      "Execution returned no verifiable Solana submission evidence.",
    );
  const value = response as Record<string, unknown>;
  if (typeof value.txid !== "string")
    throw new Error("Execution returned no Solana transaction signature.");
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value.txid);
  } catch {
    throw new Error(
      "Execution returned a malformed Solana transaction signature.",
    );
  }
  if (
    bytes.length !== 64 ||
    bytes.every((byte) => byte === 0) ||
    bs58.encode(bytes) !== value.txid
  )
    throw new Error(
      "Execution returned an invalid Solana transaction signature.",
    );
  for (const field of ["proposal", "proposal_pubkey"] as const) {
    if (
      expected.proposal &&
      value[field] !== undefined &&
      value[field] !== expected.proposal
    )
      throw new Error("Execution response belongs to a different proposal.");
  }
  if (
    expected.requireProposal &&
    value.proposal !== expected.proposal &&
    value.proposal_pubkey !== expected.proposal
  )
    throw new Error(
      "Execution response is missing the expected proposal identity.",
    );
  if (expected.path && value.path !== expected.path)
    throw new Error(
      "Execution response belongs to a different execution action.",
    );
  return value.txid;
}
