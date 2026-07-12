import { describe, expect, it } from "vitest";
import {
  clearSignActionKindCode,
  clearSignEnvelopeHash,
  clearSignPayloadHash,
  clearSignVoteMessage,
  summarizeClearSignAction,
  type AgentSessionGrantPayload,
  type AgentRiskPolicyPayload,
  type AgentTradePayload,
  type AgentTradeSettlementPayload,
  type ClearSignEnvelope,
  type EscrowReturnPayload,
  type SendPayload,
} from "@/lib/clearsign-v2";
import { fromHex, sha256, toHex } from "@/lib/msig/hash";

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

  it("can hash executable Solana recipients as pubkey bytes", () => {
    const recipient = "2ZeWpoE8G2GMLDmeYvsWmBkWmD25kHZch9uNibb6yGFu";
    const executable: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "2.5",
        asset: "SOL",
        recipient,
        recipientEncoding: "solana_pubkey",
      },
    };
    const displayOnly: ClearSignEnvelope<SendPayload> = {
      ...executable,
      payload: {
        ...executable.payload,
        recipientEncoding: "text",
      },
    };

    expect(clearSignPayloadHash(executable)).toMatch(/^[0-9a-f]{64}$/);
    expect(clearSignPayloadHash(executable)).not.toBe(
      clearSignPayloadHash(displayOnly),
    );
  });

  it("binds cross-chain send recipient and asset as text commitments", () => {
    const committed: ClearSignEnvelope<SendPayload> = {
      ...base,
      kind: "send",
      payload: {
        amount: "1.250000000000000000",
        asset: "eth",
        assetEncoding: "sha256_text",
        recipient: "0x742d35Cc6634C0532925a3b844Bc454e4438f44e",
        recipientEncoding: "sha256_text",
      },
    };
    const plain: ClearSignEnvelope<SendPayload> = {
      ...committed,
      payload: {
        ...committed.payload,
        assetEncoding: "text",
        recipientEncoding: "text",
      },
    };
    const recipientChanged: ClearSignEnvelope<SendPayload> = {
      ...committed,
      payload: {
        ...committed.payload,
        recipient: "0x1111111111111111111111111111111111111111",
      },
    };

    expect(clearSignPayloadHash(committed)).toMatch(/^[0-9a-f]{64}$/);
    expect(clearSignPayloadHash(committed)).not.toBe(clearSignPayloadHash(plain));
    expect(clearSignPayloadHash(committed)).not.toBe(
      clearSignPayloadHash(recipientChanged),
    );
  });

  it("uses the same fixed action codes as the Solana program", () => {
    expect(clearSignActionKindCode("send")).toBe(1);
    expect(clearSignActionKindCode("return_escrow_funds")).toBe(8);
    expect(clearSignActionKindCode("swap_intent")).toBe(11);
    expect(clearSignActionKindCode("agent_session_grant")).toBe(12);
    expect(clearSignActionKindCode("agent_risk_policy")).toBe(13);
    expect(clearSignActionKindCode("agent_trade_settlement")).toBe(14);
  });

  it("binds agent session status and limits into the payload hash", () => {
    const envelope: ClearSignEnvelope<AgentSessionGrantPayload> = {
      ...base,
      kind: "agent_session_grant",
      payload: {
        sessionId: "session-1",
        agentId: "agent-1",
        venue: "hyperliquid_testnet",
        market: "BTC-PERP",
        maxNotionalUsd: "250",
        maxLeverage: "2.5x",
        expiresAt: 1_782_988_800,
        status: "active",
      },
    };

    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, status: "revoked" },
      }),
    );
    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, maxNotionalUsd: "251" },
      }),
    );
  });

  it("binds agent trade approval v2 fields into the payload hash", () => {
    const envelope: ClearSignEnvelope<AgentTradePayload> = {
      ...base,
      kind: "agent_trade_approval",
      payload: {
        agentId: "agent-1",
        venue: "Hyperliquid Testnet",
        market: "btc-perp",
        side: "long",
        maxNotionalUsd: "250.00",
        maxLeverage: "2.5x",
        stopLossRequired: true,
        assetId: "USDC:hyperliquid:testnet",
        sessionId: "agent-session:morning-risk-pass",
        route: "clearsig-agent:hyperliquid:testnet:limit",
        riskCheckHash:
          "8a58cb501c3269e8abe8f456629b04e12855131b2e8b1e6807749817d167a9d4",
      },
    };

    expect(clearSignPayloadHash(envelope)).toMatch(/^[0-9a-f]{64}$/);
    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: {
          ...envelope.payload,
          riskCheckHash:
            "2d4724a75961caff9e395a8d610dc4720c02bd809138e54ce2d32681bfcd9f49",
        },
      }),
    );
    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: {
          ...envelope.payload,
          route: "clearsig-agent:hyperliquid:testnet:market",
        },
      }),
    );
  });

  it("rejects partial agent trade approval v2 payloads", () => {
    const envelope: ClearSignEnvelope<AgentTradePayload> = {
      ...base,
      kind: "agent_trade_approval",
      payload: {
        venue: "Hyperliquid Testnet",
        market: "BTC-PERP",
        side: "long",
        maxNotionalUsd: "250",
        maxLeverage: "2.5x",
        stopLossRequired: true,
      },
    };

    expect(() => clearSignPayloadHash(envelope)).toThrow(
      /requires agentId, venue, assetId, sessionId, route, and riskCheckHash/,
    );
  });

  it("binds agent loss policy and oracle assumptions", () => {
    const envelope: ClearSignEnvelope<AgentRiskPolicyPayload> = {
      ...base,
      kind: "agent_risk_policy",
      payload: {
        sessionId: "session-1",
        oraclePolicyHash: "11".repeat(32),
        maxLossRaw: "100000000",
        status: "active",
      },
    };

    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, maxLossRaw: "100000001" },
      }),
    );
    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, oraclePolicyHash: "22".repeat(32) },
      }),
    );
  });

  it("binds agent settlement artifact, accounting, and sequence", () => {
    const envelope: ClearSignEnvelope<AgentTradeSettlementPayload> = {
      ...base,
      kind: "agent_trade_settlement",
      payload: {
        sessionId: "session-1",
        executionId: "execution-1",
        settlementArtifactHash: "33".repeat(32),
        oraclePolicyHash: "11".repeat(32),
        closedNotionalRaw: "250000000",
        outcome: "loss",
        pnlAbsRaw: "50000000",
        settlementSequence: 4,
      },
    };

    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, settlementSequence: 5 },
      }),
    );
    expect(clearSignPayloadHash(envelope)).not.toBe(
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, settlementArtifactHash: "44".repeat(32) },
      }),
    );
    expect(() =>
      clearSignPayloadHash({
        ...envelope,
        payload: {
          ...envelope.payload,
          settlementSequence: Number.MAX_SAFE_INTEGER + 1,
        },
      }),
    ).toThrow(/non-negative safe integer/);
    expect(() =>
      clearSignPayloadHash({
        ...envelope,
        payload: { ...envelope.payload, settlementArtifactHash: "abcd" },
      }),
    ).toThrow(/settlementArtifactHash must be a 32-byte hex hash/);
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

  it("length-prefixes action and nonce commitments like the Solana program", () => {
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
      legacyEnvelopeHashWithoutCommitmentLengths(envelope),
    );
  });

  it("builds readable vote messages for typed proposal signatures", () => {
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
    const signableText = summarizeClearSignAction(envelope).signableText;
    const propose = new TextDecoder().decode(clearSignVoteMessage({
      voteKind: "propose",
      walletName: base.walletName,
      proposalIndex: 7,
      envelopeHash,
      signableText,
    }));

    expect(propose).toContain("ClearSign v2 propose\nWallet Team\nProposal 7\nEnvelope ");
    expect(propose).toContain("\n\nSend 2.5 SOL from Team to Sarah");
    expect(propose).toContain("Requires wallet approval");
    expect(propose).toContain(`Payload ${clearSignPayloadHash(envelope)}`);
  });
});

function legacyEnvelopeHashWithoutCommitmentLengths(
  envelope: ClearSignEnvelope<SendPayload>,
): string {
  const signableText = summarizeClearSignAction(envelope).signableText;
  const out = new TestWriter();
  out.pushBytes("clearsig:policy-engine:v2");
  out.pushU8(2);
  out.pushU8(clearSignActionKindCode(envelope.kind));
  out.pushI64(BigInt(envelope.expiresAt));
  out.pushBytes(envelope.walletName.trim());
  out.pushBytes(envelope.walletId?.trim() ?? "");
  out.pushRaw(sha256(new TextEncoder().encode(envelope.actionId.trim())));
  out.pushRaw(sha256(new TextEncoder().encode(envelope.nonce.trim())));
  out.pushRaw(fromHex(envelope.policyCommitment));
  out.pushRaw(fromHex(clearSignPayloadHash(envelope)));
  out.pushRaw(sha256(new TextEncoder().encode(signableText)));
  return toHex(sha256(out.bytes()));
}

class TestWriter {
  private chunks: number[] = [];

  pushRaw(bytes: Uint8Array) {
    for (const byte of bytes) this.chunks.push(byte);
  }

  pushBytes(value: string | Uint8Array) {
    const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
    this.pushU32(bytes.length);
    this.pushRaw(bytes);
  }

  pushU8(value: number) {
    this.chunks.push(value & 0xff);
  }

  pushU32(value: number) {
    for (let i = 0; i < 4; i++) this.chunks.push((value >> (8 * i)) & 0xff);
  }

  pushI64(value: bigint) {
    let v = BigInt.asUintN(64, value);
    for (let i = 0; i < 8; i++) {
      this.chunks.push(Number(v & 0xffn));
      v >>= 8n;
    }
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.chunks);
  }
}
