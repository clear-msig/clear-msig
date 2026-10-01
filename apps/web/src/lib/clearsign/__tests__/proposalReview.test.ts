import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import type { IntentAccount, TypedProposalAccount } from "@/lib/msig/accounts";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { sha256, toHex } from "@/lib/msig/hash";
import {
  bindApprovalDescriptor,
  canonicalReviewEnvelope,
  verifyCanonicalProposalReview,
} from "../proposalReview";

const enc = new TextEncoder();
const fixture = readFileSync(
  resolve(process.cwd(), "../../tests/fixtures/clearsign-v4-transfer.txt"),
  "utf8",
);
const document = fixture.split("---document---\n")[1].trimEnd();
const field = (key: string) =>
  fixture.match(new RegExp(`^${key}=(.*)$`, "m"))![1];
const pk = (n: number) => new PublicKey(new Uint8Array(32).fill(n)).toBase58();
function example() {
  const actionIdHex = toHex(sha256(enc.encode("vector-action-1"))),
    nonceHex = toHex(sha256(enc.encode("vector-nonce-1")));
  const p: TypedProposalAccount = {
    typed: true,
    wallet: pk(7),
    intent: pk(9),
    proposalIndex: 6n,
    proposer: pk(8),
    status: 0,
    statusLabel: "Active",
    actionKind: 1,
    proposedAt: 0n,
    approvedAt: 0n,
    expiresAt: 1784000000n,
    bump: 1,
    approvalBitmap: 0,
    cancellationBitmap: 0,
    rentRefund: pk(8),
    policyCommitment:
      "c600ec3abadbd1b6eedb4c2e54acbd519e51281d1c8f368b10344c871b0c959a",
    payloadHash: field("payload"),
    envelopeHash: field("envelope"),
    actionId: "raw action",
    nonce: "raw nonce",
    actionIdHex,
    nonceHex,
    policyBytesHex: "",
    clearTextHex: toHex(enc.encode(document)),
  };
  const i: IntentAccount = {
    wallet: pk(7),
    bump: 1,
    intentIndex: 0,
    intentType: 0,
    chainKind: 0,
    approved: true,
    approvalThreshold: 2,
    cancellationThreshold: 2,
    timelockSeconds: 0,
    templateOffset: 0,
    templateLen: 0,
    txTemplateOffset: 0,
    txTemplateLen: 0,
    activeProposalCount: 1,
    proposers: [pk(8)],
    approvers: [pk(8), pk(9), pk(10)],
    params: [],
    accounts: [],
    instructions: [],
    dataSegments: [],
    seeds: [],
    policyCiphertexts: new Uint8Array(),
    policyCiphertextIds: [],
    bytePool: new Uint8Array(),
    template: "",
  };
  return { p, i };
}
function review(p = example().p, i = example().i) {
  return verifyCanonicalProposalReview(p, i, "Team treasury", pk(11));
}
function descriptor(): TypedDryRunDescriptor {
  const r = review(),
    b = r.binding;
  const text = [
    r.document,
    "",
    "APPROVAL",
    "Decision: APPROVE",
    "Proposal: #6",
    "Wallet: Team treasury",
    `Requested by: ${pk(8)}`,
    "Requirement: 2 approvals",
    "Status if accepted: 1 of 2 approvals",
    "",
    "EXPIRY",
    new Date(Number(r.expiresAt) * 1000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ") + " UTC",
    "",
    "PROOF",
    "ClearSign: v4",
    `Envelope: ${r.envelopeHash}`,
  ].join("\n");
  return {
    action: "proposal_typed_approve",
    wallet_name: r.walletName,
    wallet_pubkey: b.wallet,
    intent_pubkey: b.intent,
    intent_index: 0,
    proposal_pubkey: r.proposalAddress,
    proposal_index: 6,
    signer_pubkey: pk(8),
    action_kind: 1,
    action_id: b.actionId,
    nonce: b.nonce,
    policy_commitment_hex: b.policy,
    payload_hash_hex: r.payloadHash,
    envelope_hash_hex: r.envelopeHash,
    approval_requirement: 2,
    approval_kind: "approvals",
    approval_count_after: 1,
    expiry: Number(r.expiresAt),
    message_flavor: "clearsign_v4_document",
    message_hex: toHex(enc.encode(text)),
  } as TypedDryRunDescriptor;
}
describe("canonical proposal review (synthetic accounts, existing Rust golden vector)", () => {
  it("matches the cross-language envelope and preserves every document byte", () => {
    const { p } = example();
    expect(canonicalReviewEnvelope(p, "Team treasury", 2, 1)).toBe(
      field("envelope"),
    );
    expect(review().document).toBe(document);
    expect(review().network).toBe("Solana Devnet");
  });
  it.each([0, 6, 10, 11, 16, 17])(
    "blocks unsupported or opaque policy kind %s",
    (kind) => {
      const { p } = example();
      p.actionKind = kind;
      expect(() => review(p)).toThrow(/blocked/i);
    },
  );
  it.each(["clearTextHex", "actionIdHex", "nonceHex"] as const)(
    "blocks absent %s",
    (key) => {
      const { p } = example();
      delete p[key];
      expect(() => review(p)).toThrow();
    },
  );
  it.each([
    "payloadHash",
    "policyCommitment",
    "envelopeHash",
    "actionIdHex",
    "nonceHex",
  ] as const)("rejects mutated %s", (key) => {
    const { p } = example();
    p[key] = "ab".repeat(32);
    expect(() => review(p)).toThrow();
  });
  it.each([
    ["0.3 SOL", "300 SOL"],
    ["Network: Solana Devnet", "Network: Mainnet"],
    ["To: p2Y", "To: XXX"],
    ["signatures required", "signatures optional"],
    ["clearsig-full-v2@1", "clearsig-ledger-solana-v2@1"],
  ])("rejects document mutation %s", (before, after) => {
    const { p } = example();
    p.clearTextHex = toHex(enc.encode(document.replace(before, after)));
    expect(() => review(p)).toThrow();
  });
  it.each(["Amount:", "To:", "Network:"])(
    "rejects absent required %s even with a matching envelope",
    (prefix) => {
      const { p } = example();
      p.clearTextHex = toHex(
        enc.encode(
          document
            .split("\n")
            .filter((l) => !l.startsWith(prefix))
            .join("\n"),
        ),
      );
      p.envelopeHash = canonicalReviewEnvelope(p, "Team treasury", 2, 1);
      expect(() => review(p)).toThrow(/missing/);
    },
  );
  it("rejects malformed UTF8, control text and oversized documents", () => {
    for (const hex of [
      "ff",
      "00",
      toHex(enc.encode(document + "\u202e")),
      "61".repeat(1793),
    ]) {
      const { p } = example();
      p.clearTextHex = hex;
      expect(() => review(p)).toThrow();
    }
  });
  it("binds the exact prepared approval without original intent bytes", () => {
    expect(() =>
      bindApprovalDescriptor(review(), descriptor(), pk(8), 1783999000000),
    ).not.toThrow();
  });
  it.each([
    "wallet_name",
    "wallet_pubkey",
    "intent_pubkey",
    "proposal_pubkey",
    "signer_pubkey",
    "action_id",
    "nonce",
    "policy_commitment_hex",
    "payload_hash_hex",
    "envelope_hash_hex",
    "message_hex",
  ] as const)("rejects substituted descriptor %s", (key) => {
    const d = descriptor();
    d[key] = "substitution";
    expect(() =>
      bindApprovalDescriptor(review(), d, pk(8), 1783999000000),
    ).toThrow();
  });
  it.each([
    "proposal_index",
    "intent_index",
    "action_kind",
    "approval_requirement",
    "approval_count_after",
    "expiry",
  ] as const)("rejects substituted numeric %s", (key) => {
    const d = descriptor();
    d[key]++;
    expect(() =>
      bindApprovalDescriptor(review(), d, pk(8), 1783999000000),
    ).toThrow();
  });
  it("rejects expired requests and repeat or ineligible approvals", () => {
    expect(() =>
      bindApprovalDescriptor(review(), descriptor(), pk(8), 1784000000000),
    ).toThrow();
    expect(() =>
      bindApprovalDescriptor(review(), descriptor(), pk(12), 1783999000000),
    ).toThrow();
    const { p } = example();
    p.approvalBitmap = 1;
    expect(() =>
      bindApprovalDescriptor(review(p), descriptor(), pk(8), 1783999000000),
    ).toThrow();
  });
  it("changes the reviewed fingerprint when current authority changes", () => {
    const { i } = example();
    const before = review();
    i.approvers[2] = pk(12);
    expect(review(undefined, i).reviewId).not.toBe(before.reviewId);
    expect(Object.isFrozen(before.binding.approvers)).toBe(true);
  });
});

// Synthetic full-profile shapes follow full.rs; only the transfer above is a
// cross-language golden vector. These do not claim executable venue support.
const governance =
  "Target intent: #0\nApproval threshold: 2\nCancellation threshold: 2\nTimelock seconds: 0\nFinal proposers: A\nFinal approvers: A, B";
const shapes: [number, string, string][] = [
  [2, "Send batch of 1 payments", "Payment 1: 0.3 SOL to Example"],
  [3, "Update member authority", governance],
  [4, "Remove member authority", governance],
  [5, "Change approval rules", governance],
  [
    7,
    "Release escrow milestone",
    "Escrow: Test\nEscrow ID: e1\nMilestone: Test\nMilestone ID: m1\nAmount: 1 SOL\nRecipient: Example",
  ],
  [
    8,
    "Return escrow funds",
    "Escrow: Test\nEscrow ID: e1\nReturn 1: 1 SOL to Example",
  ],
  [
    9,
    "Approve agent trade",
    "Agent: Test\nVenue: Test\nMarket: BTC\nSide: long\nAsset ID: USDC\nMaximum notional: 1 USDC\nMaximum leverage: 1x\nSession: s1\nRoute: r1\nRisk check: c1",
  ],
  [
    12,
    "Grant agent session",
    "Session: s1\nAgent: Test\nVenue: Test\nMarket: BTC\nMaximum notional: 1 USDC\nMaximum leverage: 1x\nSession expiry (Unix): 1800000000",
  ],
  [
    13,
    "Set agent risk policy",
    "Session: s1\nMaximum realized loss (raw): 1000000\nOracle policy: c1",
  ],
  [
    14,
    "Settle agent execution",
    "Session: s1\nExecution: e1\nClosed notional (raw): 1000000\nOutcome: flat\nAbsolute P/L (raw): 0\nSettlement sequence: 1\nSettlement artifact: c1\nOracle policy: c2",
  ],
  [
    15,
    "Create recurring payment",
    "Schedule: Test\nAmount per payment: 1 SOL\nRecipient: Example\nCadence seconds: 60\nFirst payment (Unix): 1800000000\nMaximum payments: 2",
  ],
];
describe("supported action document coverage", () => {
  it.each(shapes)(
    "preserves all fields for kind %s and rejects a missing first field",
    (kind, headline, details) => {
      const { p } = example();
      p.actionKind = kind;
      const sections = document.split("\n\n");
      sections[1] = "ACTION\n" + headline;
      sections[2] = `DETAILS\n${kind === 2 ? "From wallet" : "Wallet"}: Team treasury\nNetwork: Solana Devnet\n${details}`;
      p.clearTextHex = toHex(enc.encode(sections.join("\n\n")));
      p.envelopeHash = canonicalReviewEnvelope(p, "Team treasury", 2, 1);
      expect(review(p).document).toContain(details);
      sections[2] = sections[2].replace("\n" + details.split("\n")[0], "");
      p.clearTextHex = toHex(enc.encode(sections.join("\n\n")));
      p.envelopeHash = canonicalReviewEnvelope(p, "Team treasury", 2, 1);
      expect(() => review(p)).toThrow(/missing/);
    },
  );
});
