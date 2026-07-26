import { describe, expect, it } from "vitest";

import type { TypedDryRunDescriptor } from "@/lib/api/types";
import {
  TypedClearSignMessageVerificationError,
  verifiedTypedClearSignMessageBytes,
} from "@/lib/clearsign/typedMessage";
import { toHex } from "@/lib/msig";

const payloadHash =
  "08122a16809fa2402d135967016f84489a024d8ad89b0b385e8b45eede15be4d";
const envelopeHash =
  "2d4724a75961caff9e395a8d610dc4720c02bd809138e54ce2d32681bfcd9f49";

describe("typed ClearSign message verification", () => {
  it("accepts a readable typed proposal vote bound to the descriptor", () => {
    const descriptor = typedDescriptor();

    expect(verifiedTypedClearSignMessageBytes(descriptor)).toEqual(
      fromText(descriptorText()),
    );
  });

  it("accepts v4 only with canonical bytes and the v4 protocol marker", () => {
    const text = descriptorText()
      .replace(documentText(), v4DocumentText())
      .replace("ClearSign: v3", "ClearSign: v4");
    const descriptor = typedDescriptor({
      canonical_intent_hex: "44".repeat(64),
      message_flavor: "clearsign_v4_document",
      message_hex: toHex(fromText(text)),
    });

    expect(
      verifiedTypedClearSignMessageBytes(descriptor, {
        envelopeHash,
        payloadHash,
        signableText: v4DocumentText(),
      }),
    ).toEqual(fromText(text));

    expect(() =>
      verifiedTypedClearSignMessageBytes({
        ...descriptor,
        canonical_intent_hex: undefined,
      }),
    ).toThrow("missing its canonical intent bytes");
  });

  it("accepts a transaction-bound compact v4 device document", () => {
    const body = compactV4DocumentText();
    const text = descriptorTextForBody(body, 4);
    const descriptor = typedDescriptor({
      canonical_intent_hex: "44".repeat(64),
      message_flavor: "clearsign_v4_document",
      message_hex: toHex(fromText(text)),
    });

    expect(
      verifiedTypedClearSignMessageBytes(descriptor, {
        envelopeHash,
        payloadHash,
        signableText: body,
      }),
    ).toEqual(fromText(text));
  });

  it("rejects compact v4 documents with substituted proposal context", () => {
    const body = compactV4DocumentText().replace("PROPOSAL 1", "PROPOSAL 9");
    const descriptor = typedDescriptor({
      canonical_intent_hex: "44".repeat(64),
      message_flavor: "clearsign_v4_document",
      message_hex: toHex(fromText(descriptorTextForBody(body, 4))),
    });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "invalid compact device document",
    );
  });

  it("rejects a vote message with a swapped envelope hash", () => {
    const descriptor = typedDescriptor({
      message_hex: toHex(
        fromText(descriptorText({ envelopeHash: "11".repeat(32) })),
      ),
    });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      TypedClearSignMessageVerificationError,
    );
  });

  it("rejects non-readable typed message bytes", () => {
    const descriptor = typedDescriptor({ message_hex: "fffeff" });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "not readable UTF-8",
    );
  });

  it("rejects a backend message that differs from the browser-reviewed transaction", () => {
    const descriptor = typedDescriptor();

    expect(() =>
      verifiedTypedClearSignMessageBytes(descriptor, {
        envelopeHash,
        payloadHash,
        signableText: documentText().replace("Send 1 SOL", "Send 2 SOL"),
      }),
    ).toThrow("does not match the transaction reviewed in this browser");
  });

  it("rejects a legacy v2 proposal create as a downgrade", () => {
    const descriptor = {
      ...typedDescriptor(),
      message_flavor: "clearsign_v2_text",
    } as unknown as TypedDryRunDescriptor;

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "restricted to existing proposal approvals",
    );
  });

  it("accepts a strictly bound legacy v2 approval for an existing proposal", () => {
    const descriptor = typedDescriptor({
      action: "proposal_typed_approve",
      message_flavor: "clearsign_v2_text",
      message_hex: toHex(fromText([
        "ClearSign v2 approve",
        "Wallet Team treasury#5qxnc7",
        "Proposal 1",
        `Envelope ${envelopeHash}`,
        "",
        "Send 1 SOL to operations",
      ].join("\n"))),
    });

    expect(verifiedTypedClearSignMessageBytes(descriptor)).toEqual(
      fromText([
        "ClearSign v2 approve",
        "Wallet Team treasury#5qxnc7",
        "Proposal 1",
        `Envelope ${envelopeHash}`,
        "",
        "Send 1 SOL to operations",
      ].join("\n")),
    );
  });

  it("rejects a legacy v2 approval with substituted proposal proof", () => {
    const descriptor = typedDescriptor({
      action: "proposal_typed_approve",
      message_flavor: "clearsign_v2_text",
      message_hex: toHex(fromText([
        "ClearSign v2 approve",
        "Wallet Team treasury#5qxnc7",
        "Proposal 9",
        `Envelope ${envelopeHash}`,
        "",
        "Send 1 SOL to operations",
      ].join("\n"))),
    });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "does not match the stored proposal",
    );
  });

  it("rejects duplicate or injected document sections", () => {
    const text = descriptorText().replace(
      "\n\nPURPOSE\nTest payment",
      "\n\nPURPOSE\nTest payment\n\nPROOF\nInjected proof",
    );
    const descriptor = typedDescriptor({ message_hex: toHex(fromText(text)) });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "duplicate or unexpected document sections",
    );
  });

  it("rejects a displayed expiry that differs from the onchain descriptor", () => {
    const text = descriptorText().replace(
      "2026-07-07 12:15:31 UTC",
      "2026-07-08 12:15:31 UTC",
    );
    const descriptor = typedDescriptor({ message_hex: toHex(fromText(text)) });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "approval or proof does not match",
    );
  });

  it("rejects substituted approval requirements", () => {
    const descriptor = typedDescriptor({ approval_requirement: 3 });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "approval or proof does not match",
    );
  });

  it("rejects control-character injection", () => {
    const text = descriptorText().replace("Test payment", "Test\tpayment");
    const descriptor = typedDescriptor({ message_hex: toHex(fromText(text)) });

    expect(() => verifiedTypedClearSignMessageBytes(descriptor)).toThrow(
      "unsafe control characters",
    );
  });
});

function typedDescriptor(
  overrides: Partial<TypedDryRunDescriptor> = {},
): TypedDryRunDescriptor {
  return {
    action: "proposal_typed_create",
    wallet_name: "Team treasury#5qxnc7",
    wallet_pubkey: "Wallet1111111111111111111111111111111111",
    intent_index: 3,
    intent_pubkey: "Intent1111111111111111111111111111111111",
    proposal_pubkey: "Proposal111111111111111111111111111111",
    proposal_index: 1,
    signer_pubkey: "Signer1111111111111111111111111111111111",
    approval_requirement: 2,
    approval_count_after: 1,
    approval_kind: "approvals",
    action_kind: 1,
    policy_commitment_hex: "22".repeat(32),
    payload_hash_hex: payloadHash,
    envelope_hash_hex: envelopeHash,
    action_id:
      "sol-send:0xe75e86c6f1d6af5ded17d784182b7078dd84b9d58310c75ed8160e53fe9d0334",
    nonce:
      "nonce:0x1e67383e73f8a5157177cb25846b0b7da30fc3aedaa306eba0651b0e6b1f163f",
    message_hex: toHex(fromText(descriptorText())),
    message_flavor: "clearsign_v3_document",
    expiry: 1_783_426_531,
    ...overrides,
  };
}

function descriptorText(
  overrides: { envelopeHash?: string } = {},
): string {
  const hash = overrides.envelopeHash ?? envelopeHash;
  return [
    documentText(),
    "",
    "APPROVAL",
    "Decision: PROPOSE",
    "Proposal: #1",
    "Wallet: Team treasury#5qxnc7",
    "Requested by: Signer1111111111111111111111111111111111",
    "Requirement: 2 approvals",
    "Status if accepted: 1 of 2 approvals",
    "",
    "EXPIRY",
    "2026-07-07 12:15:31 UTC",
    "",
    "PROOF",
    "ClearSign: v3",
    `Envelope: ${hash}`,
  ].join("\n");
}

function descriptorTextForBody(body: string, version: 3 | 4): string {
  return [
    body,
    "",
    "APPROVAL",
    "Decision: PROPOSE",
    "Proposal: #1",
    "Wallet: Team treasury#5qxnc7",
    "Requested by: Signer1111111111111111111111111111111111",
    "Requirement: 2 approvals",
    "Status if accepted: 1 of 2 approvals",
    "",
    "EXPIRY",
    "2026-07-07 12:15:31 UTC",
    "",
    "PROOF",
    `ClearSign: v${version}`,
    `Envelope: ${envelopeHash}`,
  ].join("\n");
}

function documentText(): string {
  return [
    "ClearSig Proposal",
    "",
    "ACTION",
    "Send 1 SOL from Team treasury#5qxnc7 to 886vDaZFUheowbYv4j7mU54QSvzATKr8Lb7ySuoTVXKp",
    "",
    "DETAILS",
    "From wallet: Team treasury#5qxnc7",
    "Network: Solana devnet",
    "Amount: 1 SOL",
    "To: 886vDaZFUheowbYv4j7mU54QSvzATKr8Lb7ySuoTVXKp",
    `Payload: ${payloadHash.slice(0, 12)}...${payloadHash.slice(-12)}`,
    "",
    "POLICY",
    "Approval: Wallet's onchain threshold must be met",
    "Execution: Onchain policy and timelock must pass",
    "Commitment: 222222222222...222222222222",
    "Enforcement: Exact payload and policy must match onchain",
    "Display profile: clearsig-full-v1@1",
    "",
    "RISK",
    "Category: Funds movement",
    "Signer check: Verify amount, asset, network, and every destination",
    "",
    "PURPOSE",
    "Test payment",
  ].join("\n");
}

function v4DocumentText(): string {
  return documentText()
    .replace("ClearSig Proposal", "ClearSig Approval")
    .replace(
      "Display profile: clearsig-full-v1@1",
      "Display profile: clearsig-full-v2@1\nProtocol: clearsig-intent-v4@1",
    );
}

function compactV4DocumentText(): string {
  return [
    "SEND 1 SOL",
    "TO 886vDaZFUheowbYv4j7mU54QSvzATKr8Lb7ySuoTVXKp",
    "NET Solana Devnet",
    "FROM Team treasury#5qxnc7",
    "APPROVAL 2",
    "PROPOSAL 1",
    "EXPIRES 1783426531",
    `POLICY ${"22".repeat(32)}`,
    "PROFILE clearsig-ledger-solana-v2@1",
    "Protocol: clearsig-intent-v4@1",
  ].join("\n");
}

function fromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
