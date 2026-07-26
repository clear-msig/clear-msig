import { describe, expect, it } from "vitest";
import {
  canonicalAgentSignalPayload,
  signAgentSignalPayload,
  verifyAgentSignalSignature,
} from "@/lib/agents/signalSignature";
import type { AgentSignalPayload } from "@/lib/agents/intake";

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
    expect(signAgentSignalPayload({ signal, signalKey: "signal-key" })).toBe(
      signAgentSignalPayload({ signal: reordered, signalKey: "signal-key" }),
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
    const signature = signAgentSignalPayload({
      signal,
      signalKey: "first-key",
    });

    expect(
      verifyAgentSignalSignature({
        signal,
        signalKey: "first-key",
        signature,
      }).ok,
    ).toBe(true);
    expect(
      verifyAgentSignalSignature({
        signal,
        signalKey: "second-key",
        signature,
      }).ok,
    ).toBe(false);
  });
});
