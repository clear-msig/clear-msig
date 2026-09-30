import { describe, expect, it } from "vitest";
import {
  canonicalAgentSignalPayload,
  signAgentSignalPayload,
  verifyAgentSignalSignature,
} from "@/lib/agents/signalSignature";
import type { AgentSignalPayload } from "@/lib/agents/intake";

const target = { walletAddress: "canonical-wallet", agentId: "agent", programId: "program", network: "test-deployment" };

describe("agent signal signatures", () => {
  it("signs canonical signal payloads independent of object key order", () => {
    const signal: AgentSignalPayload = {
      clientSignalId: "creator-signal-1",
      submittedAt: 1_800_000_000_000,
      venue: "mock_perps",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      stopLossPrice: "68000",
      thesis: "BTC reclaimed support.",
      riskPlan: "Small size with stop.",
      invalidation: "Support fails.",
    };
    const reordered = {
      invalidation: signal.invalidation,
      riskPlan: signal.riskPlan,
      thesis: signal.thesis,
      stopLossPrice: signal.stopLossPrice,
      leverage: signal.leverage,
      notionalUsd: signal.notionalUsd,
      orderType: signal.orderType,
      side: signal.side,
      market: signal.market,
      venue: signal.venue,
      submittedAt: signal.submittedAt,
      clientSignalId: signal.clientSignalId,
    } as AgentSignalPayload;

    expect(canonicalAgentSignalPayload(signal)).toBe(
      canonicalAgentSignalPayload(reordered),
    );
    expect(signAgentSignalPayload({ target, signal, signalKey: "signal-key" })).toBe(
      signAgentSignalPayload({ target, signal: reordered, signalKey: "signal-key" }),
    );
  });

  it("rejects signatures from a different signal key", () => {
    const signal: AgentSignalPayload = {
      clientSignalId: "creator-signal-1",
      submittedAt: 1_800_000_000_000,
      venue: "mock_perps",
      market: "BTC-PERP",
      side: "long",
      notionalUsd: "250",
      leverage: 1,
    };
    const signature = signAgentSignalPayload({ target,
      signal,
      signalKey: "first-key",
    });

    expect(
      verifyAgentSignalSignature({ target,
        signal,
        signalKey: "first-key",
        signature,
      }).ok,
    ).toBe(true);
    expect(
      verifyAgentSignalSignature({ target,
        signal,
        signalKey: "second-key",
        signature,
      }).ok,
    ).toBe(false);
  });
});

describe("signal v2 target and replay metadata binding", () => {
  const signal: AgentSignalPayload = { clientSignalId: "nonce", submittedAt: 1_800_000_000_000, venue: "mock_perps", market: "BTC-PERP", side: "long", notionalUsd: "1", leverage: 1 };
  it.each(["walletAddress", "agentId", "programId", "network"] as const)("rejects a substituted %s even with the same shared key", (field) => {
    const signature = signAgentSignalPayload({ signal, signalKey: "key", target });
    expect(verifyAgentSignalSignature({ signal, signalKey: "key", signature, target: { ...target, [field]: "other" } }).ok).toBe(false);
  });
  it("binds timestamp, nonce and complete payload", () => {
    const signature = signAgentSignalPayload({ signal, signalKey: "key", target });
    for (const change of [{ submittedAt: signal.submittedAt! + 1 }, { clientSignalId: "other" }, { notionalUsd: "1000" }]) {
      expect(verifyAgentSignalSignature({ signal: { ...signal, ...change }, signalKey: "key", signature, target }).ok).toBe(false);
    }
  });
  it.each([{ clientSignalId: undefined }, { submittedAt: undefined }, { submittedAt: 0 }, { submittedAt: NaN }])("rejects missing or invalid replay metadata %j", (change) => {
    expect(() => signAgentSignalPayload({ signal: { ...signal, ...change }, signalKey: "key", target })).toThrow("nonce and timestamp");
  });
});
