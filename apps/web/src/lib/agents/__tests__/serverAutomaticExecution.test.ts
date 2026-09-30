import { agentTestWalletAddress } from "@/test/agents/walletScope";
import { agentTestDeploymentIdentity } from "@/test/agents/walletScope";

vi.mock("@/lib/auth/walletAuthorization", async () => {
  const { withAgentTestWallet, agentTestWalletAddress } = await import("@/test/agents/walletScope");
  return {
    withWalletMember: (_request: unknown, walletName: string, handler: (auth: object) => Promise<unknown>) =>
      withAgentTestWallet(walletName, () => handler({ walletName, walletAddress: agentTestWalletAddress(walletName) })),
    withCanonicalAgentWallet: (walletName: string, handler: (address: string) => Promise<unknown>) =>
      withAgentTestWallet(walletName, () => handler(agentTestWalletAddress(walletName))),
  };
});
import { saveApprovedSession } from "@/test/agents/signedOwnerApproval";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { POST as submitAgentSignal } from "@/app/api/agent-signals/[name]/[agent]/route";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { executeAllowedAgentProposal } from "@/test/agents/serverOperations";
import { registerAgentSignalKey } from "@/test/agents/serverInbox";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import { signAgentSignalPayload } from "@/lib/agents/signalSignature";
import {
  getAgentServerWalletState,
  saveAgentServerOwnerApproval,
  saveAgentServerProfile,
  saveAgentServerProposal,
  saveAgentServerVaultPolicy,
  updateAgentServerSessionStatus,
} from "@/test/agents/serverState";
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
  it("requires wallet approval before registering automatic signal import", async () => {
    const walletName = "automatic-register-route";

    const response = await submitAgentSignal(
      registerRequest(walletName, true),
      {
        params: Promise.resolve({
          name: walletName,
          agent: "agent-alpha",
        }),
      },
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("wallet-signed owner approval");
  });

  it("registers automatic signal import after wallet approval", async () => {
    const walletName = "automatic-register-approved-route";
    await saveAgentServerOwnerApproval(
      signedAutomaticApproval({
        walletName,
        agentId: "agent-alpha",
      }),
    );

    const response = await submitAgentSignal(
      registerRequest(walletName, true),
      {
        params: Promise.resolve({
          name: walletName,
          agent: "agent-alpha",
        }),
      },
    );

    expect(response.status).toBe(200);
  });

  it("places an allowed built-in practice trade once", async () => {
    await saveAgentServerProfile(agent());
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    await saveApprovedSession(session());
    const saved = await saveAgentServerProposal(proposal());

    const first = await executeAllowedAgentProposal(saved.proposal);
    const second = await executeAllowedAgentProposal(saved.proposal);
    const state = await getAgentServerWalletState(walletName);

    expect(first.placed).toBe(true);
    expect(second.placed).toBe(true);
    expect(state.executions).toHaveLength(1);
    expect(state.proposals[0]?.status).toBe("executed");
  });

  it.each(["paused", "revoked", "expired"] as const)("does not automatically execute after its session is %s", async (status) => {
    const pausedWallet = `automatic-session-${status}`;
    await saveAgentServerProfile(agent(pausedWallet));
    await saveAgentServerVaultPolicy({ ...defaultAgentVaultPolicy(pausedWallet, now), cooldownSeconds: 0 });
    await saveApprovedSession(session(pausedWallet));
    const saved = await saveAgentServerProposal({ ...proposal(), walletName: pausedWallet });
    expect(saved.proposal.status).toBe("approved");
    await updateAgentServerSessionStatus({ walletName: pausedWallet, id: "session-1", status });

    const result = await executeAllowedAgentProposal(saved.proposal);

    expect(result.placed).toBe(false);
    expect(result.message).toContain("active allowance");
    expect((await getAgentServerWalletState(pausedWallet)).executions).toHaveLength(0);
  });

  it("does not automatically execute after its allowance policy becomes stale", async () => {
    const staleWallet = "automatic-session-stale";
    await saveAgentServerProfile(agent(staleWallet));
    const policy = { ...defaultAgentVaultPolicy(staleWallet, now), cooldownSeconds: 0 };
    await saveAgentServerVaultPolicy(policy);
    await saveApprovedSession(session(staleWallet));
    const saved = await saveAgentServerProposal({ ...proposal(), walletName: staleWallet });
    await saveAgentServerVaultPolicy({ ...policy, maxSessionHours: 25 });

    expect((await executeAllowedAgentProposal(saved.proposal)).placed).toBe(false);
    expect((await getAgentServerWalletState(staleWallet)).executions).toHaveLength(0);
  });

  it("places an allowed practice trade when the trader sends an idea", async () => {
    const routeWalletName = "automatic-signal-route";
    await saveAgentServerProfile(agent(routeWalletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(routeWalletName, now),
      cooldownSeconds: 0,
    });
    await saveApprovedSession(session(routeWalletName));
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
          body: (() => {
            const signal = {
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
            } as const;
            return JSON.stringify({ signal, signatureScheme: "hmac_sha256_v2", signature: signAgentSignalPayload({
              signal, signalKey: "signal-key", target: { ...agentTestDeploymentIdentity(), walletAddress: agentTestWalletAddress(routeWalletName), agentId: "agent-alpha" },
            }) });
          })(),
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
      target: { ...agentTestDeploymentIdentity(), walletAddress: agentTestWalletAddress(routeWalletName), agentId: "agent-alpha" },
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
          body: JSON.stringify({ signal, signatureScheme: "hmac_sha256_v2" }),
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

function registerRequest(walletName: string, autoImportSessionSignals: boolean): NextRequest {
  return new NextRequest(
    `http://localhost/api/agent-signals/${walletName}/agent-alpha`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        action: "register",
        signalKey: "signal-key",
        managementKey: "management-key",
        autoImportSessionSignals,
      }),
    },
  );
}

function signedAutomaticApproval({
  walletName,
  agentId,
}: {
  walletName: string;
  agentId: string;
}) {
  const keypair = nacl.sign.keyPair();
  const approvedBy = new PublicKey(keypair.publicKey).toBase58();
  const input = {
    walletName,
    agentId,
    action: "start_automatic_trading" as const,
    summary: "Turn on automatic trading",
    targetType: "agent" as const,
    targetId: agentId,
    details: [{ label: "Trader", value: "Agent Alpha" }],
  };
  const message = ownerApprovalSignableText(input, now);
  return {
    id: `approval-${agentId}`,
    ...input,
    approvalMethod: "wallet_signature" as const,
    signatureVersion: 2 as const,
    approvedBy,
    signature: bytesToHex(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    ),
    approvalHash: `hash-${agentId}`,
    createdAt: now,
    version: 1 as const,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
