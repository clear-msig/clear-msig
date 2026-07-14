import { afterEach, describe, expect, it, vi } from "vitest";

import { prepareClearSignAction } from "@/lib/clearsign/client";
import {
  summarizeClearSignAction,
  type ClearSignEnvelope,
  type SendPayload,
} from "@/lib/clearsign";

const envelope: ClearSignEnvelope<SendPayload> = {
  version: 3,
  kind: "send",
  walletName: "Team",
  walletId: "Team#abc",
  actionId: "send-1",
  nonce: "nonce-1",
  expiresAt: 1_900_000_000,
  policyCommitment:
    "1111111111111111111111111111111111111111111111111111111111111111",
  payload: {
    recipient: "Sarah",
    amount: "2.5",
    asset: "SOL",
  },
};

describe("prepareClearSignAction", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses the backend prepare response when available", async () => {
    const local = summarizeClearSignAction(envelope);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 3,
            kind: "send",
            actionKindCode: 1,
            ...local,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    const summary = await prepareClearSignAction(envelope);

    expect(summary.source).toBe("backend");
    expect(summary.payloadHash).toBe(local.payloadHash);
  });

  it("rejects a backend summary that changes readable transaction details", async () => {
    const local = summarizeClearSignAction(envelope);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            version: 3,
            kind: "send",
            actionKindCode: 1,
            ...local,
            headline: "Send 25 SOL from Team to Sarah",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );

    await expect(prepareClearSignAction(envelope)).rejects.toThrow(
      "backend prepared different transaction details",
    );
  });

  it("requires explicit opt-in before falling back to local summary", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    await expect(prepareClearSignAction(envelope)).rejects.toThrow(
      "Failed to fetch",
    );

    const summary = await prepareClearSignAction(envelope, { fallback: true });

    expect(summary.source).toBe("local");
    expect(summary.headline).toBe("Send 2.5 SOL from Team to Sarah");
    expect(summary.payloadHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
