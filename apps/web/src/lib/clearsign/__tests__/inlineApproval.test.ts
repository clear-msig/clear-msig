import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { inlineApprovalOptions, savedProposalError } from "../inlineApproval";
import type { TypedDryRunDescriptor } from "@/lib/api/types";
import { CLEAR_WALLET_PROGRAM_ID } from "@/lib/chain/client";
import { findTypedProposalAddress } from "@/lib/msig/pda";
import { sha256, toHex } from "@/lib/msig/hash";
import { formatTimestamp } from "@/lib/msig/datetime";

const signer = new PublicKey(new Uint8Array(32).fill(7));
const intent = new PublicKey(new Uint8Array(32).fill(8));
const proposal = findTypedProposalAddress(
  intent,
  6n,
  CLEAR_WALLET_PROGRAM_ID,
)[0].toBase58();
const stored = (s: string) =>
  new TextDecoder().decode(sha256(new TextEncoder().encode(s)));
function fixture(kind = 1, compact = false) {
  const creation: TypedDryRunDescriptor = {
    action: "proposal_typed_create",
    wallet_name: "Treasury",
    wallet_pubkey: signer.toBase58(),
    intent_index: 0,
    intent_pubkey: intent.toBase58(),
    proposal_index: 6,
    proposal_pubkey: proposal,
    signer_pubkey: signer.toBase58(),
    approval_requirement: 2,
    approval_count_after: 0,
    approval_kind: "approvals",
    action_kind: kind,
    policy_commitment_hex: "aa".repeat(32),
    payload_hash_hex: "bb".repeat(32),
    envelope_hash_hex: "cc".repeat(32),
    action_id: "action-one",
    nonce: "nonce-one",
    canonical_intent_hex: "abcd",
    message_hex: "",
    message_flavor: "clearsign_v4_document",
    expiry: 1900000000,
  };
  const body = compact
    ? [
        "SEND 5 SOL",
        "TO full-address",
        "NET Solana Devnet",
        "FROM Treasury",
        "APPROVAL 2",
        "PROPOSAL 6",
        "EXPIRES 1900000000",
        `POLICY ${creation.policy_commitment_hex}`,
        "PROFILE clearsig-ledger-solana-v2@1",
        "Protocol: clearsig-intent-v4@1",
      ].join("\n")
    : [
        "ClearSig Approval",
        "ACTION\nSend 5 SOL",
        "DETAILS\nNetwork: Solana Devnet\nAmount: 5 SOL\nTo: full-address",
        "POLICY\nDisplay profile: clearsig-full-v2@1\nProtocol: clearsig-intent-v4@1",
        "RISK\nVerify destination",
        "PURPOSE\nTransfer",
      ].join("\n\n");
  const expected = {
    envelopeHash: creation.envelope_hash_hex,
    payloadHash: creation.payload_hash_hex,
    signableText: body,
  };
  const approval = {
    ...creation,
    action: "proposal_typed_approve",
    action_id: stored(creation.action_id),
    nonce: stored(creation.nonce),
    approval_count_after: 1,
    canonical_intent_hex: undefined,
  };
  for (const d of [creation, approval])
    d.message_hex = toHex(
      new TextEncoder().encode(
        [
          body,
          "",
          "APPROVAL",
          `Decision: ${d === creation ? "PROPOSE" : "APPROVE"}`,
          "Proposal: #6",
          "Wallet: Treasury",
          `Requested by: ${signer.toBase58()}`,
          "Requirement: 2 approvals",
          `Status if accepted: ${d.approval_count_after} of 2 approvals`,
          "",
          "EXPIRY",
          `${formatTimestamp(d.expiry)} UTC`,
          "",
          "PROOF",
          "ClearSign: v4",
          `Envelope: ${d.envelope_hash_hex}`,
        ].join("\n"),
      ),
    );
  return { creation, approval, expected };
}
describe("just-created inline approval binding (synthetic descriptors, no RPC/wallet)", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 13, 14, 15, 16])(
    "preserves reviewed v4 kind %s",
    (kind) => {
      const f = fixture(kind);
      expect(
        inlineApprovalOptions(
          f.creation,
          f.approval,
          f.expected,
          proposal,
          signer,
        ),
      ).toEqual({ preferSigner: signer, expectedTyped: f.expected });
    },
  );
  it("preserves independently reviewed compact hardware document", () => {
    const f = fixture(1, true);
    expect(
      inlineApprovalOptions(
        f.creation,
        f.approval,
        f.expected,
        proposal,
        signer,
      ).expectedTyped,
    ).toEqual(f.expected);
  });
  it.each([
    "wallet_name",
    "wallet_pubkey",
    "intent_index",
    "intent_pubkey",
    "proposal_index",
    "proposal_pubkey",
    "action_kind",
    "policy_commitment_hex",
    "approval_requirement",
    "expiry",
    "message_flavor",
    "action",
    "signer_pubkey",
    "action_id",
    "nonce",
    "envelope_hash_hex",
    "payload_hash_hex",
    "message_hex",
  ] as const)("rejects altered approval %s before wallet", (field) => {
    const f = fixture();
    const altered = {
      ...f.approval,
      [field]:
        typeof f.approval[field] === "number"
          ? Number(f.approval[field]) + 1
          : "substitution",
    } as TypedDryRunDescriptor;
    expect(() =>
      inlineApprovalOptions(f.creation, altered, f.expected, proposal, signer),
    ).toThrow("already created");
  });
  it("rejects substituted submission address even when prepare repeats it", () => {
    const f = fixture();
    const wrong = signer.toBase58();
    expect(() =>
      inlineApprovalOptions(
        { ...f.creation, proposal_pubkey: wrong },
        { ...f.approval, proposal_pubkey: wrong },
        f.expected,
        wrong,
        signer,
      ),
    ).toThrow("canonical request");
  });
  it.each(["signableText", "envelopeHash", "payloadHash"] as const)(
    "requires independent creation %s",
    (field) => {
      const f = fixture();
      expect(() =>
        inlineApprovalOptions(
          f.creation,
          f.approval,
          { ...f.expected, [field]: "substituted" },
          proposal,
          signer,
        ),
      ).toThrow("already created");
    },
  );
  it("retains accepted proposal identity and original cause for safe recovery", () => {
    const cause = new Error("Wallet cancelled");
    const e = savedProposalError(proposal, cause);
    expect(e).toMatchObject({
      proposalAddress: proposal,
      cause,
      __clearMsigExecuteFailedProposal: proposal,
    });
    expect(e.message).toContain("do not create it again");
  });
});
