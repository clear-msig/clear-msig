import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as submitAgentSignal } from "@/app/api/agent-signals/[name]/[agent]/route";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { executeAllowedAgentProposal } from "@/lib/agents/serverAutomaticExecution";
import { registerAgentSignalKey } from "@/lib/agents/serverInbox";
import { signAgentSignalPayload } from "@/lib/agents/signalSignature";
import {
  getAgentServerWalletState,
  saveAgentServerProfile,
  saveAgentServerProposal,
  saveAgentServerSession,
  saveAgentServerVaultPolicy,
} from "@/lib/agents/serverState";
import type { AgentProfile, AgentSessionGrant, AgentTradeProposal } from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);
const walletName = "automatic-execution";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("automatic allowed execution", () => {
  it("places an allowed built-in practice trade once", async () => {
    await saveAgentServerProfile(agent());
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    await saveAgentServerSession(session());
    const saved = await saveAgentServerProposal(proposal());

    const first = await executeAllowedAgentProposal(saved.proposal);
    const second = await executeAllowedAgentProposal(saved.proposal);
    const state = await getAgentServerWalletState(walletName);

    expect(first.placed).toBe(true);
    expect(second.placed).toBe(true);
    expect(state.executions).toHaveLength(1);
    expect(state.proposals[0]?.status).toBe("executed");
  });

  it("places an allowed practice trade when the trader sends an idea", async () => {
    const routeWalletName = "automatic-signal-route";
    await saveAgentServerProfile(agent(routeWalletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(routeWalletName, now),
      cooldownSeconds: 0,
    });
    await saveAgentServerSession(session(routeWalletName));
    await registerAgentSignalKey({
      walletName: routeWalletName,
      agentId: "agent-alpha",
      signalKey: "signal-key",
      managementKey: "management-key",
      autoImportSessionSignals: true,
    });

    const response = await submitAgentSignal(
      new NextRequest(
        `http://localhost/api/agent-signals/${routeWalletName}/agent-alpha`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-clearsig-signal-key": "signal-key",
          },
          body: JSON.stringify({
            signal: {
              clientSignalId: "automatic-route-1",
              submittedAt: now,
              venue: "mock_perps",
              market: "BTC-PERP",
              side: "long",
              orderType: "market",
              notionalUsd: "250",
              leverage: 1,
              stopLossPrice: "65000",
              confidence: 72,
              expiresInMinutes: 15,
            },
          }),
        },
      ),
      {
        params: Promise.resolve({
          name: routeWalletName,
          agent: "agent-alpha",
        }),
      },
    );
    const body = (await response.json()) as { status?: string };
    const state = await getAgentServerWalletState(routeWalletName);

    expect(response.status).toBe(200);
    expect(body.status).toBe("accepted_and_placed");
    expect(state.executions).toHaveLength(1);
    expect(state.proposals[0]?.status).toBe("executed");
  });

  it("rejects an external trader signal with a mismatched signature", async () => {
    const routeWalletName = "signed-signal-route";
    await registerAgentSignalKey({
      walletName: routeWalletName,
      agentId: "agent-alpha",
      signalKey: "signal-key",
      managementKey: "management-key",
      autoImportSessionSignals: false,
    });
    const signal = {
      clientSignalId: "signed-route-1",
      submittedAt: now,
      venue: "mock_perps" as const,
      market: "BTC-PERP",
      side: "long" as const,
      orderType: "market" as const,
      notionalUsd: "250",
      leverage: 1,
      stopLossPrice: "65000",
      confidence: 72,
      expiresInMinutes: 15,
    };
    const signature = signAgentSignalPayload({
      signal,
      signalKey: "different-key",
    });

    const response = await submitAgentSignal(
      new NextRequest(
        `http://localhost/api/agent-signals/${routeWalletName}/agent-alpha`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-clearsig-signal-key": "signal-key",
            "x-clearsig-signal-signature": signature,
          },
          body: JSON.stringify({ signal }),
        },
      ),
      {
        params: Promise.resolve({
          name: routeWalletName,
          agent: "agent-alpha",
        }),
      },
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(401);
    expect(body.error).toBe("Signal signature failed verification.");
  });
});

function agent(name = walletName): AgentProfile {
  return {
    id: "agent-alpha",
    walletName: name,
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "paper",
      allowedMarkets: ["BTC-PERP"],
      entryRules: "Clear momentum only.",
      exitRules: "Exit on invalidation.",
      riskRules: "Respect safety rules.",
      executionProtocol: "Practice only.",
      killSwitchRules: "Stop when asked.",
      updatedAt: now,
    },
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function session(name = walletName): AgentSessionGrant {
  return {
    id: "session-1",
    walletName: name,
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

function proposal(): AgentTradeProposal {
  return {
    id: "proposal-1",
    walletName,
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "65000",
    confidence: 72,
    expiresAt: now + 15 * 60 * 1000,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}
