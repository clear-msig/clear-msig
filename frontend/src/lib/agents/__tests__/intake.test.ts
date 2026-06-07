import { describe, expect, it } from "vitest";
import {
  buildAgentTradeProposalFromSignal,
  parseAgentSignalJson,
  sampleAgentSignalPayload,
  type AgentProfile,
} from "@/lib/agents";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

function agent(): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: "vault",
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

describe("agent signal intake", () => {
  it("parses a standard trade signal payload", () => {
    const result = parseAgentSignalJson(JSON.stringify(sampleAgentSignalPayload()));

    expect(result.errors).toHaveLength(0);
    expect(result.payload?.market).toBe("BTC-PERP");
    expect(result.payload?.side).toBe("long");
    expect(result.payload?.clientSignalId).toMatch(/^signal-/);
    expect(result.payload?.submittedAt).toEqual(expect.any(Number));
  });

  it("rejects malformed or unsafe signal values", () => {
    const result = parseAgentSignalJson(
      JSON.stringify({
        venue: "unknown",
        market: "",
        side: "buy",
        clientSignalId: "bad id with spaces",
        submittedAt: "yesterday",
        notionalUsd: "0",
        leverage: 0,
      }),
    );

    expect(result.payload).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Venue must be a supported trading venue.",
        "Market is required.",
        "Side must be long or short.",
        "Client signal ID must be 80 safe characters or fewer.",
        "Submitted at must be a Unix millisecond timestamp.",
        "Notional size must be greater than zero.",
        "Leverage must be greater than zero.",
      ]),
    );
  });

  it("requires retry metadata for external bot signals", () => {
    const result = parseAgentSignalJson(
      JSON.stringify({
        venue: "mock_perps",
        market: "BTC-PERP",
        side: "long",
        notionalUsd: "250",
        leverage: 1,
      }),
      { requireClientMetadata: true },
    );

    expect(result.payload).toBeNull();
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Client signal ID is required.",
        "Submitted at is required.",
      ]),
    );
  });

  it("builds an internal trade proposal from a valid signal", () => {
    const parsed = parseAgentSignalJson(
      JSON.stringify({
        ...sampleAgentSignalPayload(),
        submittedAt: now,
      }),
    );
    const proposal = buildAgentTradeProposalFromSignal({
      walletName: "vault",
      agent: agent(),
      signal: parsed.payload!,
      now,
    });

    expect(proposal.agentId).toBe("agent-alpha");
    expect(proposal.status).toBe("draft");
    expect(proposal.clientSignalId).toBe(parsed.payload?.clientSignalId);
    expect(proposal.expiresAt).toBe(now + 15 * 60 * 1000);
    expect(proposal.createdAt).toBe(now);
  });

  it("keeps old bot signals expired when they are imported later", () => {
    const submittedAt = now - 30 * 60 * 1000;
    const parsed = parseAgentSignalJson(
      JSON.stringify({
        ...sampleAgentSignalPayload(),
        submittedAt,
        expiresInMinutes: 15,
      }),
    );

    const proposal = buildAgentTradeProposalFromSignal({
      walletName: "vault",
      agent: agent(),
      signal: parsed.payload!,
      now,
    });

    expect(proposal.expiresAt).toBe(submittedAt + 15 * 60 * 1000);
    expect(proposal.expiresAt).toBeLessThan(now);
  });
});
