import { describe, expect, it } from "vitest";
import {
  clearSignActionKindCode,
  clearSignEnvelopeHash,
  clearSignPayloadHash,
  clearSignVoteMessageHash,
  summarizeClearSignAction,
  type ClearSignEnvelope,
  type EscrowReturnPayload,
  type SendPayload,
} from "@/lib/clearsign-v2";

const base = {
  version: 2 as const,
  walletName: "Team",
  walletId: "WalletPda111",
  actionId: "action-1",
  nonce: "nonce-1",
  expiresAt: 1_782_988_800,
  policyCommitment:
    "4efe872d78c9ae2539f70ecc1d88dd3f764862cef132a3700e0db695d631382c",
};

describe("ClearSign v2 actions", () => {
  it("summarizes a send as a simple money movement", () => {
    const envelope: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5000",
        asset: "sol",
        recipient: "Sarah",
      },
    };

    const summary = summarizeClearSignAction(envelope);

    expect(summary.headline).toBe("Send 2.5 SOL from Team to Sarah");
    expect(summary.lines).toEqual([
      "Send 2.5 SOL from Team to Sarah",
      "Requires wallet approval",
    ]);
    expect(summary.signableText).toContain("Wallet Team");
    expect(summary.signableText).toContain("Payload ");
    expect(summary.payloadHash).toMatch(/^[0-9a-f]{64}$/);
    expect(summary.envelopeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("summarizes escrow return with each recipient visible", () => {
    const envelope: ClearSignEnvelope<EscrowReturnPayload> = {
      ...base,
      kind: "return_escrow_funds",
      payload: {
        escrowTitle: "Website redesign",
        returns: [
          {
            recipient: "Alice",
            amount: "4.500000",
            asset: "SOL",
          },
          {
            recipient: "Bob",
            amount: "3",
            asset: "SOL",
          },
        ],
      },
    };

    expect(summarizeClearSignAction(envelope).lines).toEqual([
      "Return remaining escrow funds from Team",
      "Alice receives 4.5 SOL",
      "Bob receives 3 SOL",
      "Requires wallet approval",
    ]);
  });

  it("hashes canonical payloads independent of harmless formatting", () => {
    const a: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5000",
        asset: "sol",
        recipient: " Sarah ",
      },
    };
    const b: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5",
        asset: "SOL",
        recipient: "Sarah",
      },
    };

    expect(clearSignPayloadHash(a)).toBe(clearSignPayloadHash(b));
  });

  it("hash changes when the actual recipient changes", () => {
    const a: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5",
        asset: "SOL",
        recipient: "Sarah",
      },
    };
    const b: ClearSignEnvelope<SendPayload> = {
      ...a,
      payload: {
        ...a.payload,
        recipient: "Mina",
      },
    };

    expect(clearSignPayloadHash(a)).not.toBe(clearSignPayloadHash(b));
  });

  it("uses the same fixed action codes as the Solana program", () => {
    expect(clearSignActionKindCode("send")).toBe(1);
    expect(clearSignActionKindCode("return_escrow_funds")).toBe(8);
    expect(clearSignActionKindCode("swap_intent")).toBe(11);
  });

  it("binds envelope hash to replay fields", () => {
    const envelope: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5",
        asset: "SOL",
        recipient: "Sarah",
      },
    };

    expect(clearSignEnvelopeHash(envelope)).not.toBe(
      clearSignEnvelopeHash({ ...envelope, nonce: "nonce-2" }),
    );
    expect(clearSignEnvelopeHash(envelope)).not.toBe(
      clearSignEnvelopeHash({ ...envelope, walletId: "OtherWallet" }),
    );
  });

  it("binds vote hashes to vote kind and proposal index", () => {
    const envelope: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5",
        asset: "SOL",
        recipient: "Sarah",
      },
    };
    const envelopeHash = clearSignEnvelopeHash(envelope);
    const propose = clearSignVoteMessageHash({
      voteKind: "propose",
      walletId: base.walletId,
      proposalIndex: 7,
      envelopeHash,
    });

    expect(propose).not.toBe(
      clearSignVoteMessageHash({
        voteKind: "approve",
        walletId: base.walletId,
        proposalIndex: 7,
        envelopeHash,
      }),
    );
    expect(propose).not.toBe(
      clearSignVoteMessageHash({
        voteKind: "propose",
        walletId: base.walletId,
        proposalIndex: 8,
        envelopeHash,
      }),
    );
  });
});
