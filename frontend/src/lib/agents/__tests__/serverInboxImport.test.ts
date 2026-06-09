import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { enqueueAgentSignal, listAgentInboxSignals } from "@/lib/agents/serverInbox";
import { importAgentInboxSignals } from "@/lib/agents/serverInboxImport";
import {
  getAgentServerWalletState,
  saveAgentServerProfile,
  saveAgentServerSession,
  saveAgentServerVaultPolicy,
} from "@/lib/agents/serverState";
import type { AgentProfile, AgentSessionGrant } from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

function agent(walletName: string): AgentProfile {
  return {
    id: "agent-alpha",
    walletName,
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "paper",
      allowedMarkets: ["BTC-PERP"],
      entryRules: "Momentum setup only.",
      exitRules: "Exit on invalidation.",
      riskRules: "Respect vault limits.",
      executionProtocol: "Paper execution only.",
      killSwitchRules: "Stop when risk fails.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function session(walletName: string): AgentSessionGrant {
  return {
    id: "session-1",
    walletName,
    agentId: "agent-alpha",
    status: "active",
    startsAt: now,
    expiresAt: now + 60 * 60 * 1000,
    allowedVenues: ["mock_perps"],
    allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "300",
    maxLeverage: 1,
    maxOpenPositions: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("server inbox import", () => {
  it("imports queued signals into backend state and removes imported inbox items", async () => {
    const walletName = "server-inbox-import";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    await saveAgentServerSession(session(walletName));
    const queued = await enqueueAgentSignal({
      walletName,
      agentId: "agent-alpha",
      payload: {
        clientSignalId: "retry-import-1",
        submittedAt: now,
        venue: "mock_perps",
        market: "BTC-PERP",
        side: "long",
        orderType: "market",
        notionalUsd: "250",
        leverage: 1,
        stopLossPrice: "65000",
        takeProfitPrice: null,
        confidence: 72,
        expiresInMinutes: 15,
        thesis: "Momentum breakout.",
        technicalSummary: "BTC reclaimed support.",
        riskPlan: "Small position with defined stop.",
      },
    });

    const imported = await importAgentInboxSignals({
      walletName,
      agentId: "agent-alpha",
      ids: [queued.item.id],
      allowedOnly: true,
    });
    const state = await getAgentServerWalletState(walletName);

    expect(imported.imported).toHaveLength(1);
    expect(imported.removed).toBe(1);
    expect(imported.imported[0]?.proposal.status).toBe("approved");
    expect(imported.imported[0]?.proposal.decisionJournal?.technicalSummary).toBe(
      "BTC reclaimed support.",
    );
    expect(imported.imported[0]?.proposal.decisionJournal?.riskPlan).toBe(
      "Small position with defined stop.",
    );
    expect(state.proposals).toHaveLength(1);
    expect(await listAgentInboxSignals(walletName, "agent-alpha")).toHaveLength(0);
  });

  it("keeps non-allowed signals queued when importing allowed-only", async () => {
    const walletName = "server-inbox-import-skipped";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    const queued = await enqueueAgentSignal({
      walletName,
      agentId: "agent-alpha",
      payload: {
        clientSignalId: "retry-import-2",
        submittedAt: now,
        venue: "mock_perps",
        market: "BTC-PERP",
        side: "long",
        orderType: "market",
        notionalUsd: "250",
        leverage: 1,
        stopLossPrice: "65000",
        takeProfitPrice: null,
        confidence: 72,
        expiresInMinutes: 15,
        thesis: "Momentum breakout.",
      },
    });

    const imported = await importAgentInboxSignals({
      walletName,
      agentId: "agent-alpha",
      ids: [queued.item.id],
      allowedOnly: true,
    });
    const state = await getAgentServerWalletState(walletName);

    expect(imported.imported).toHaveLength(0);
    expect(imported.skipped).toHaveLength(1);
    expect(imported.removed).toBe(0);
    expect(state.proposals).toHaveLength(0);
    expect(await listAgentInboxSignals(walletName, "agent-alpha")).toHaveLength(1);
  });
});
