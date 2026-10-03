import {
  Connection,
  PublicKey,
  type ParsedInstruction,
  type PartiallyDecodedInstruction,
  type ParsedTransactionWithMeta,
} from "@solana/web3.js";
import bs58 from "bs58";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { formatTimestamp } from "@/lib/msig/datetime";
import { readOwnedProposalContext } from "./cancellationReview";
import { readCanonicalProposalReview } from "./readProposalReview";
import type { CanonicalProposalReview } from "./proposalReview";

const PAGE_SIZE = 8;
const MAX_PAGES = 2;
const MAX_VOTES = 16;
export type HistoricalVote = {
  transaction: string;
  instructionIndex: number;
  slot: number;
  blockTime: number | null;
  vote: "approve" | "cancel";
  memberIndex: number;
  signer: string | null;
  attribution: string;
};
export type ProposalVoteHistoryResult = {
  rows: HistoricalVote[];
  scannedTransactions: number;
  unavailableTransactions: number;
  failedTransactions: number;
  innerVoteInstructions: number;
  stoppedAtLimit: boolean;
  scanError: boolean;
  chainIdentity: string;
};
export type VoteHistoryContext = {
  wallet: string;
  intent: string;
  proposal: string;
  approvers: readonly string[];
  approvalThreshold: number;
  cancellationThreshold: number;
  canonical?: CanonicalProposalReview;
};
/** Mirrors generated approve{,_typed}/cancel{,_typed} instructions: the member is
 * an index and detached signature, never the transaction's fee payer. */
export function decodeHistoricalVote(
  ix: ParsedInstruction | PartiallyDecodedInstruction,
  context: VoteHistoryContext,
) {
  if (
    !ix.programId.equals(CLEAR_WALLET_PROGRAM_ID) ||
    !("data" in ix) ||
    ix.accounts.length !== 3
  )
    return null;
  if (
    ix.accounts.map((key) => key.toBase58()).join("\n") !==
    [context.wallet, context.intent, context.proposal].join("\n")
  )
    return null;
  let data: Uint8Array;
  try {
    data = bs58.decode(ix.data);
  } catch {
    return null;
  }
  const typed = data[0] === 9 || data[0] === 10;
  if (
    !(typed || data[0] === 2 || data[0] === 3) ||
    data.length !== (typed ? 66 : 74)
  )
    return null;
  const memberIndex = data[typed ? 1 : 9];
  if (memberIndex > 15) return null;
  return {
    typed,
    memberIndex,
    vote: (data[0] === 9 || data[0] === 2 ? "approve" : "cancel") as
      "approve" | "cancel",
    signature: data.slice(typed ? 2 : 10),
  };
}
/** Exact full-profile v4 suffix from programs/clear-wallet/src/utils/clearsign.rs.
 * Only the currently verified threshold and indexed candidate are attempted.
 * A different historical roster/threshold is unavailable, never guessed. */
export function historicalVoteMessage(
  review: CanonicalProposalReview,
  signer: string,
  vote: "approve" | "cancel",
  required: number,
  after: number,
): Uint8Array {
  const label =
    vote === "cancel"
      ? required === 1
        ? "cancellation"
        : "cancellations"
      : required === 1
        ? "approval"
        : "approvals";
  return new TextEncoder().encode(
    `${review.document}\n\nAPPROVAL\nDecision: ${vote.toUpperCase()}\nProposal: #${review.binding.index}\nWallet: ${review.walletName}\nRequested by: ${signer}\nRequirement: ${required} ${label}\nStatus if accepted: ${after} of ${required} ${label}\n\nEXPIRY\n${formatTimestamp(review.expiresAt)} UTC\n\nPROOF\nClearSign: v4\nEnvelope: ${review.envelopeHash}`,
  );
}
async function attributeVote(
  decoded: NonNullable<ReturnType<typeof decodeHistoricalVote>>,
  context: VoteHistoryContext,
) {
  const candidate = context.approvers[decoded.memberIndex];
  if (!decoded.typed || !context.canonical)
    return {
      signer: null,
      attribution:
        "Signer unavailable: this instruction has no supported, verified v4 document.",
    };
  if (
    context.canonical.proposalAddress !== context.proposal ||
    context.canonical.binding.wallet !== context.wallet ||
    context.canonical.binding.intent !== context.intent
  )
    return {
      signer: null,
      attribution:
        "Signer unavailable: canonical document account binding differs.",
    };
  if (!candidate)
    return {
      signer: null,
      attribution:
        "Signer unavailable: the historical member is not in the current roster.",
    };
  const required =
    decoded.vote === "approve"
      ? context.approvalThreshold
      : context.cancellationThreshold;
  if (!Number.isInteger(required) || required < 1 || required > 16)
    return {
      signer: null,
      attribution:
        "Signer unavailable: historical vote rules are not verifiable.",
    };
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new Uint8Array(new PublicKey(candidate).toBytes()),
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    // At most sixteen asynchronous native checks per instruction; no threshold
    // or member brute force, and no synchronous crypto loop on the main thread.
    for (let after = 1; after <= 16; after++) {
      const message = historicalVoteMessage(
        context.canonical,
        candidate,
        decoded.vote,
        required,
        after,
      );
      if (
        await crypto.subtle.verify(
          "Ed25519",
          key,
          new Uint8Array(decoded.signature),
          new Uint8Array(message),
        )
      )
        return {
          signer: candidate,
          attribution:
            "Detached vote signature verified against the canonical document.",
        };
    }
    return {
      signer: null,
      attribution:
        "Signer unavailable: the current candidate/rules do not verify this historical signature.",
    };
  } catch {
    return {
      signer: null,
      attribution:
        "Signer unavailable: signature verification is unsupported or failed.",
    };
  }
}
export async function inspectVoteTransaction(
  transaction: ParsedTransactionWithMeta,
  signature: string,
  slot: number,
  context: VoteHistoryContext,
  maxVotes = MAX_VOTES,
): Promise<{ rows: HistoricalVote[]; innerVoteInstructions: number }> {
  if (
    !transaction.meta ||
    transaction.meta.err !== null ||
    transaction.slot !== slot ||
    transaction.transaction.signatures[0] !== signature
  )
    throw new Error(
      "Successful transaction identity/slot could not be verified.",
    );
  const instructions = transaction.transaction.message.instructions;
  if (instructions.length > 256)
    throw new Error(
      "Transaction instruction count exceeds the bounded verifier.",
    );
  const decodedInstructions = instructions.flatMap((ix, instructionIndex) => {
    const decoded = decodeHistoricalVote(ix, context);
    return decoded ? [{ decoded, instructionIndex }] : [];
  });
  if (decodedInstructions.length > maxVotes)
    throw new Error("Vote count exceeds the bounded verifier.");
  // Validate inner data before any cryptographic work, so malformed transactions
  // cannot consume the scan's signature budget without contributing rows.
  const innerGroups = transaction.meta.innerInstructions ?? [];
  if (
    innerGroups.length > 256 ||
    innerGroups.some((group) => group.instructions.length > 256)
  )
    throw new Error("Inner instruction count exceeds the bounded verifier.");
  const innerVoteInstructions = innerGroups.reduce(
    (sum, group) =>
      sum +
      group.instructions.filter((ix) => decodeHistoricalVote(ix, context))
        .length,
    0,
  );
  const rows: HistoricalVote[] = [];
  for (const { instructionIndex, decoded } of decodedInstructions) {
    const attributed = await attributeVote(decoded, context);
    rows.push({
      transaction: signature,
      instructionIndex,
      slot,
      blockTime:
        typeof transaction.blockTime === "number" &&
        Number.isSafeInteger(transaction.blockTime) &&
        transaction.blockTime >= 0
          ? transaction.blockTime
          : null,
      vote: decoded.vote,
      memberIndex: decoded.memberIndex,
      ...attributed,
    });
  }
  // CPI failures can be caught by a successful parent. Never treat inner
  // instructions as accepted votes without a separately verified execution trace.
  return { rows, innerVoteInstructions };
}
export async function readBoundedVoteHistory(
  connection: Pick<
    Connection,
    "getSignaturesForAddress" | "getParsedTransaction"
  >,
  context: VoteHistoryContext,
  chainIdentity: string,
): Promise<ProposalVoteHistoryResult> {
  const result: ProposalVoteHistoryResult = {
    rows: [],
    scannedTransactions: 0,
    unavailableTransactions: 0,
    failedTransactions: 0,
    innerVoteInstructions: 0,
    stoppedAtLimit: false,
    scanError: false,
    chainIdentity,
  };
  const seen = new Set<string>();
  let before: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    let signatures;
    try {
      signatures = await connection.getSignaturesForAddress(
        new PublicKey(context.proposal),
        { limit: PAGE_SIZE, before },
        "finalized",
      );
    } catch {
      result.scanError = true;
      break;
    }
    if (!signatures.length) break;
    if (signatures.length > PAGE_SIZE) {
      result.scanError = true;
      break;
    }
    for (const info of signatures) {
      if (result.rows.length >= MAX_VOTES) {
        result.stoppedAtLimit = true;
        return result;
      }
      if (seen.has(info.signature)) {
        result.scanError = true;
        continue;
      }
      seen.add(info.signature);
      result.scannedTransactions++;
      if (info.err !== null) {
        result.failedTransactions++;
        continue;
      }
      if (
        info.confirmationStatus !== "finalized" ||
        !Number.isSafeInteger(info.slot)
      ) {
        result.unavailableTransactions++;
        continue;
      }
      try {
        const transaction = await connection.getParsedTransaction(
          info.signature,
          { commitment: "finalized", maxSupportedTransactionVersion: 0 },
        );
        if (!transaction)
          throw new Error("Transaction history is unavailable or pruned.");
        const inspected = await inspectVoteTransaction(
          transaction,
          info.signature,
          info.slot,
          context,
          MAX_VOTES - result.rows.length,
        );
        result.innerVoteInstructions += inspected.innerVoteInstructions;
        if (result.rows.length + inspected.rows.length > MAX_VOTES) {
          result.stoppedAtLimit = true;
          return result;
        }
        result.rows.push(...inspected.rows);
      } catch {
        result.unavailableTransactions++;
      }
    }
    before = signatures[signatures.length - 1].signature;
    if (signatures.length < PAGE_SIZE) break;
    if (page === MAX_PAGES - 1) result.stoppedAtLimit = true;
  }
  return result;
}
export async function loadProposalVoteHistory(
  connection: Connection,
  address: string,
) {
  const owned = await readOwnedProposalContext(connection, address);
  if (!owned)
    throw new Error(
      "Proposal accounts are unavailable; vote history cannot be bound to this request.",
    );
  let canonical: CanonicalProposalReview | undefined;
  try {
    canonical = await readCanonicalProposalReview(
      connection,
      address,
      owned.walletName,
    );
  } catch {
    /* Transaction evidence can still be shown without signer attribution. */
  }
  return readBoundedVoteHistory(
    connection,
    {
      wallet: owned.proposal.wallet,
      intent: owned.proposal.intent,
      proposal: address,
      approvers: owned.intent.approvers,
      approvalThreshold: owned.intent.approvalThreshold,
      cancellationThreshold: owned.intent.cancellationThreshold,
      canonical,
    },
    owned.chainIdentity,
  );
}
