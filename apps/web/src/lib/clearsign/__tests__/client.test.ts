import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareClearSignV4Action } from "@/lib/clearsign/client";
import type {
  ClearSignIntentInput,
  SendPayload,
} from "@/lib/clearsign";

const intent: ClearSignIntentInput<SendPayload> = {
  kind: "send",
  network: "Solana devnet",
  walletName: "Team",
  walletId: "11111111111111111111111111111111",
  actionId: "send-1",
  nonce: "nonce-1",
  expiresAt: 1_900_000_000,
  policyCommitment: "11".repeat(32),
  payload: {
    recipient: "11111111111111111111111111111111",
    amount: "2.5",
    asset: "SOL",
  },
};

describe("prepareClearSignV4Action", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses trusted canonical bytes and omits browser policy assertions", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const sentEnvelope = request.envelope as Record<string, unknown>;
      expect(sentEnvelope.version).toBe(4);
      expect(sentEnvelope).not.toHaveProperty("policyCommitment");
      expect(request).toMatchObject({
        intentIndex: 3,
        actorPubkey: "11111111111111111111111111111111",
      });
      return validResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const prepared = await prepareClearSignV4Action(intent, {
      intentIndex: 3,
      actorPubkey: "11111111111111111111111111111111",
    });

    expect(prepared.source).toBe("backend");
    expect(prepared.canonicalIntentHex).toBe("55".repeat(64));
    expect(prepared.policyCommitment).toBe("66".repeat(32));
  });

  it("has no browser fallback when trusted preparation fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(
      prepareClearSignV4Action(intent, {
        intentIndex: 3,
        actorPubkey: "11111111111111111111111111111111",
      }),
    ).rejects.toThrow("Failed to fetch");
  });

  it("rejects malformed or substituted backend bindings", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => validResponse({ kind: "batch_send" })));
    await expect(
      prepareClearSignV4Action(intent, {
        intentIndex: 3,
        actorPubkey: "11111111111111111111111111111111",
      }),
    ).rejects.toThrow("invalid binding");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => validResponse({ canonicalIntentHex: "abc" })),
    );
    await expect(
      prepareClearSignV4Action(intent, {
        intentIndex: 3,
        actorPubkey: "11111111111111111111111111111111",
      }),
    ).rejects.toThrow("invalid binding");
  });
});

function validResponse(overrides: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({
      version: 4,
      kind: "send",
      actionKindCode: 1,
      headline: "Send 2.5 SOL",
      lines: ["Send 2.5 SOL"],
      payloadHash: "22".repeat(32),
      envelopeHash: "33".repeat(32),
      canonicalIntentHash: "44".repeat(32),
      canonicalIntentHex: "55".repeat(64),
      policyCommitment: "66".repeat(32),
      signableText: "ClearSig Approval",
      deviceProfile: {
        id: "clearsig-full-v2",
        version: 1,
        mode: "full",
        maxDocumentBytes: 1792,
      },
      ...overrides,
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}
