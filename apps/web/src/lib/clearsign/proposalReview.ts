import { PublicKey } from "@solana/web3.js";
import type { IntentAccount, TypedProposalAccount } from "@/lib/msig/accounts";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { fromHex, sha256, toHex } from "@/lib/msig/hash";
import { verifiedTypedClearSignMessageBytes } from "./typedMessage";

const encoder = new TextEncoder();
const NETWORKS = [
  [1, 0, "Solana Devnet"],
  [2, 1, "Ethereum Sepolia"],
  [3, 2, "Bitcoin Testnet"],
  [4, 2, "Bitcoin Signet"],
  [5, 2, "Bitcoin Testnet4"],
  [6, 3, "Zcash Testnet"],
  [7, 5, "Hyperliquid Testnet"],
  [8, 4, "Ethereum Sepolia"],
] as const;
export const REVIEWABLE_ACTION_KINDS = [
  1, 2, 3, 4, 5, 7, 8, 9, 12, 13, 14, 15,
] as const;
export interface CanonicalProposalReview {
  reviewId: string;
  proposalAddress: string;
  walletName: string;
  document: string;
  headline: string;
  network: string;
  sections: readonly { title: string; text: string }[];
  envelopeHash: string;
  payloadHash: string;
  expiresAt: bigint;
  threshold: number;
  timelockSeconds: number;
  /** Exact copied authority fields used to reject substituted prepare responses. */
  binding: {
    wallet: string;
    intent: string;
    index: bigint;
    actionKind: number;
    policy: string;
    actionId: string;
    nonce: string;
    intentIndex: number;
    approvers: readonly string[];
    approvalBitmap: number;
  };
}
function bytes(value: Uint8Array | string): Uint8Array {
  const raw = typeof value === "string" ? encoder.encode(value) : value;
  return concat(uint(BigInt(raw.length), 4), raw);
}
function concat(...rows: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(rows.reduce((n, r) => n + r.length, 0));
  let at = 0;
  for (const row of rows) {
    result.set(row, at);
    at += row.length;
  }
  return result;
}
function uint(value: bigint, size: number): Uint8Array {
  if (value < 0n || value >= 1n << BigInt(size * 8))
    throw new Error("Unrepresentable canonical integer.");
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++)
    out[i] = Number((value >> BigInt(i * 8)) & 255n);
  return out;
}
function hashBytes(value: string | undefined): Uint8Array {
  if (!value || !/^[a-f0-9]{64}$/.test(value))
    throw new Error("Missing canonical commitment bytes.");
  return fromHex(value);
}
function count(n: number): number {
  let result = 0;
  for (let v = n; v; v >>>= 1) result += v & 1;
  return result;
}
/** Rust hashing.rs envelope_hash_fields mirror; locked against the repository golden vector. */
export function canonicalReviewEnvelope(
  proposal: TypedProposalAccount,
  walletName: string,
  threshold: number,
  network: number,
): string {
  return toHex(
    sha256(
      concat(
        bytes("clearsig:policy-engine:v4"),
        new Uint8Array([4, proposal.actionKind, network]),
        uint(proposal.proposalIndex, 8),
        bytes(walletName),
        bytes(new PublicKey(proposal.wallet).toBytes()),
        bytes(new PublicKey(proposal.proposer).toBytes()),
        bytes(hashBytes(proposal.actionIdHex)),
        bytes(hashBytes(proposal.nonceHex)),
        uint(proposal.expiresAt, 8),
        new Uint8Array([threshold]),
        hashBytes(proposal.policyCommitment),
        hashBytes(proposal.payloadHash),
        sha256(fromHex(proposal.clearTextHex ?? "")),
      ),
    ),
  );
}
export function verifyCanonicalProposalReview(
  proposal: TypedProposalAccount,
  intent: IntentAccount,
  walletName: string,
  proposalAddress: string,
): CanonicalProposalReview {
  if ([6, 16].includes(proposal.actionKind))
    throw new Error(
      "Protection-policy changes require a decoded policy review; a commitment alone is insufficient. Approval is blocked.",
    );
  if (
    !REVIEWABLE_ACTION_KINDS.includes(
      proposal.actionKind as (typeof REVIEWABLE_ACTION_KINDS)[number],
    )
  )
    throw new Error(
      "This action kind has no supported canonical review. Approval is blocked.",
    );
  if (
    !/^[\x20-\x7e]{1,64}$/.test(walletName) ||
    !intent.approved ||
    intent.wallet !== proposal.wallet ||
    !Number.isInteger(intent.approvalThreshold) ||
    !Number.isInteger(proposal.approvalBitmap) ||
    !Number.isInteger(proposal.cancellationBitmap) ||
    intent.approvalThreshold < 1 ||
    intent.approvalThreshold > intent.approvers.length ||
    intent.approvers.length > 16 ||
    new Set(intent.approvers).size !== intent.approvers.length ||
    proposal.approvalBitmap < 0 ||
    proposal.approvalBitmap >= 1 << intent.approvers.length ||
    proposal.cancellationBitmap < 0 ||
    proposal.cancellationBitmap >= 1 << intent.approvers.length
  )
    throw new Error("Invalid canonical approval authority.");
  const raw = fromHex(proposal.clearTextHex ?? "");
  if (!raw.length || raw.length > 1792)
    throw new Error(
      "Canonical review document is unavailable. Approval is blocked.",
    );
  const document = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (/[^\x20-\x7e\n]/.test(document))
    throw new Error("Unsafe canonical document text.");
  const parts = document.split("\n\n"),
    titles = [
      "ClearSig Approval",
      "ACTION",
      "DETAILS",
      "POLICY",
      "RISK",
      "PURPOSE",
    ];
  if (
    parts.length !== 6 ||
    parts[0] !== titles[0] ||
    parts
      .slice(1)
      .some(
        (p, i) =>
          !p.startsWith(titles[i + 1] + "\n") ||
          p.length <= titles[i + 1].length + 1,
      )
  )
    throw new Error(
      "A complete full-profile v4 document is required. Legacy and compact reviews are blocked.",
    );
  const fields: Record<number, string[]> = {
    1: ["From wallet:", "Amount:", "To:"],
    2: ["From wallet:", "Payment 1:"],
    3: [
      "Wallet:",
      "Target intent:",
      "Approval threshold:",
      "Cancellation threshold:",
      "Timelock seconds:",
      "Final proposers:",
      "Final approvers:",
    ],
    4: [
      "Wallet:",
      "Target intent:",
      "Approval threshold:",
      "Cancellation threshold:",
      "Timelock seconds:",
      "Final proposers:",
      "Final approvers:",
    ],
    5: [
      "Wallet:",
      "Target intent:",
      "Approval threshold:",
      "Cancellation threshold:",
      "Timelock seconds:",
      "Final proposers:",
      "Final approvers:",
    ],
    7: [
      "Wallet:",
      "Escrow:",
      "Escrow ID:",
      "Milestone:",
      "Milestone ID:",
      "Amount:",
      "Recipient:",
    ],
    8: ["Wallet:", "Escrow:", "Escrow ID:", "Return 1:"],
    9: [
      "Wallet:",
      "Agent:",
      "Venue:",
      "Market:",
      "Side:",
      "Asset ID:",
      "Maximum notional:",
      "Maximum leverage:",
      "Session:",
      "Route:",
      "Risk check:",
    ],
    12: [
      "Wallet:",
      "Session:",
      "Agent:",
      "Venue:",
      "Market:",
      "Maximum notional:",
      "Maximum leverage:",
      "Session expiry (Unix):",
    ],
    13: [
      "Wallet:",
      "Session:",
      "Maximum realized loss (raw):",
      "Oracle policy:",
    ],
    14: [
      "Wallet:",
      "Session:",
      "Execution:",
      "Closed notional (raw):",
      "Outcome:",
      "Absolute P/L (raw):",
      "Settlement sequence:",
      "Settlement artifact:",
      "Oracle policy:",
    ],
    15: [
      "Wallet:",
      "Schedule:",
      "Amount per payment:",
      "Recipient:",
      "Cadence seconds:",
      "First payment (Unix):",
      "Maximum payments:",
    ],
  };
  const detailLines = parts[2].split("\n").slice(1);
  for (const field of ["Network:", ...fields[proposal.actionKind]]) {
    if (
      detailLines.filter(
        (line) =>
          line.startsWith(field + " ") && line.length > field.length + 1,
      ).length !== 1
    )
      throw new Error(
        "Required canonical action details are missing or duplicated.",
      );
  }
  const policyLines = parts[3].split("\n");
  for (const required of [
    `Approval: ${intent.approvalThreshold} signatures required`,
    `Policy commitment: ${proposal.policyCommitment}`,
    "Display profile: clearsig-full-v2@1",
    "Protocol: clearsig-intent-v4@1",
  ])
    if (policyLines.filter((l) => l === required).length !== 1)
      throw new Error("Review policy differs from canonical authority.");
  const network = NETWORKS.find(
    ([code, chain]) =>
      chain === intent.chainKind &&
      canonicalReviewEnvelope(
        proposal,
        walletName,
        intent.approvalThreshold,
        code,
      ) === proposal.envelopeHash,
  );
  if (
    !network ||
    parts[2].split("\n").filter((l) => l === `Network: ${network[2]}`)
      .length !== 1
  )
    throw new Error(
      "Review document or network does not match the on-chain envelope.",
    );
  const sections = parts.slice(1).map((p) => {
    const at = p.indexOf("\n");
    return Object.freeze({ title: p.slice(0, at), text: p.slice(at + 1) });
  });
  const binding = Object.freeze({
    wallet: proposal.wallet,
    intent: proposal.intent,
    index: proposal.proposalIndex,
    actionKind: proposal.actionKind,
    policy: proposal.policyCommitment,
    actionId: proposal.actionId,
    nonce: proposal.nonce,
    intentIndex: intent.intentIndex,
    approvers: Object.freeze([...intent.approvers]),
    approvalBitmap: proposal.approvalBitmap,
  });
  const reviewId = toHex(
    sha256(
      encoder.encode(
        [
          proposalAddress,
          proposal.envelopeHash,
          intent.approvalThreshold,
          intent.timelockSeconds,
          ...intent.approvers,
          proposal.approvalBitmap,
          proposal.status,
        ].join("\n"),
      ),
    ),
  );
  return Object.freeze({
    reviewId,
    proposalAddress,
    walletName,
    document,
    headline: sections[0].text,
    network: network[2],
    sections: Object.freeze(sections),
    envelopeHash: proposal.envelopeHash,
    payloadHash: proposal.payloadHash,
    expiresAt: proposal.expiresAt,
    threshold: intent.approvalThreshold,
    timelockSeconds: intent.timelockSeconds,
    binding,
  });
}
export function bindApprovalDescriptor(
  review: CanonicalProposalReview,
  descriptor: TypedDryRunDescriptor,
  signer: string,
  now = Date.now(),
): void {
  const b = review.binding,
    index = b.approvers.indexOf(signer);
  if (
    index < 0 ||
    (b.approvalBitmap & (1 << index)) !== 0 ||
    descriptor.action !== "proposal_typed_approve" ||
    descriptor.wallet_name !== review.walletName ||
    descriptor.wallet_pubkey !== b.wallet ||
    descriptor.intent_pubkey !== b.intent ||
    descriptor.intent_index !== b.intentIndex ||
    descriptor.proposal_pubkey !== review.proposalAddress ||
    !Number.isSafeInteger(descriptor.proposal_index) ||
    BigInt(descriptor.proposal_index) !== b.index ||
    descriptor.signer_pubkey !== signer ||
    descriptor.action_id !== b.actionId ||
    descriptor.nonce !== b.nonce ||
    descriptor.action_kind !== b.actionKind ||
    descriptor.policy_commitment_hex !== b.policy ||
    descriptor.approval_requirement !== review.threshold ||
    descriptor.approval_kind !== "approvals" ||
    descriptor.approval_count_after !== count(b.approvalBitmap) + 1 ||
    !Number.isSafeInteger(descriptor.expiry) ||
    BigInt(descriptor.expiry) !== review.expiresAt ||
    descriptor.expiry <= Math.floor(now / 1000) + 15 ||
    descriptor.message_flavor !== "clearsign_v4_document"
  )
    throw new Error(
      "Prepared approval differs from the reviewed canonical request. Refresh and review again.",
    );
  verifiedTypedClearSignMessageBytes(descriptor, {
    envelopeHash: review.envelopeHash,
    payloadHash: review.payloadHash,
    signableText: review.document,
  });
}
