import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { POST as submitVenueExecution } from "@/app/api/agent-execution/[venue]/route";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  approveAgentServerProposal,
  saveAgentServerOwnerApproval,
  saveAgentServerProfile,
  saveAgentServerProposal,
  saveAgentServerVaultPolicy,
} from "@/lib/agents/serverState";
import type {
  AgentOwnerApproval,
  AgentProfile,
  AgentTradeProposal,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("CLEARSIG_HYPERLIQUID_TESTNET_ACCOUNT_ADDRESS", "");
  vi.stubEnv("CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_URL", "");
  vi.stubEnv("CLEARSIG_HYPERLIQUID_TESTNET_EXECUTOR_TOKEN", "");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("agent execution route owner authority", () => {
  it("rejects venue handoffs without a wallet-signed owner approval", async () => {
    const response = await submitVenueExecution(
      request("route-handoff-no-approval", "proposal-1"),
      { params: Promise.resolve({ venue: "hyperliquid_testnet" }) },
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("wallet approval");
  });

  it("continues to setup checks after the owner approval is verified", async () => {
    const walletName = "route-handoff-approved";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      allowedVenues: ["hyperliquid_testnet"],
      cooldownSeconds: 0,
    });
    const saved = await saveAgentServerProposal(proposal(walletName, "proposal-1"));
    await approveAgentServerProposal(walletName, saved.proposal.id);
    await saveAgentServerOwnerApproval(
      signedApproval({
        walletName,
        agentId: "agent-alpha",
        targetId: saved.proposal.id,
      }),
    );

    const response = await submitVenueExecution(
      request(walletName, saved.proposal.id),
      { params: Promise.resolve({ venue: "hyperliquid_testnet" }) },
    );
    const body = (await response.json()) as {
      error?: string;
      serverRequest?: { status?: string };
    };

    expect(response.status).not.toBe(409);
    expect(body.error).toBe("Server trading is not configured for this venue yet.");
    expect(body.serverRequest?.status).toBe("waiting_for_setup");
  });
});

function request(walletName: string, proposalId: string): NextRequest {
  return new NextRequest(
    "http://localhost/api/agent-execution/hyperliquid_testnet",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Host: "localhost",
        Origin: "http://localhost",
      },
      body: JSON.stringify({
        walletName,
        agentId: "agent-alpha",
        proposalId,
        venue: "hyperliquid_testnet",
        market: "BTC-PERP",
        side: "long",
        orderType: "market",
        notionalUsd: "250",
        leverage: 1,
        approvedAt: now,
      }),
    },
  );
}

function agent(walletName: string): AgentProfile {
  return {
    id: "agent-alpha",
    walletName,
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "bounded_live",
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

function proposal(walletName: string, id: string): AgentTradeProposal {
  return {
    id,
    walletName,
    agentId: "agent-alpha",
    venue: "hyperliquid_testnet",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    stopLossPrice: "65000",
    takeProfitPrice: null,
    thesis: "Momentum breakout.",
    confidence: 72,
    expiresAt: now + 15 * 60 * 1000,
    status: "needs_approval",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function signedApproval({
  walletName,
  agentId,
  targetId,
}: {
  walletName: string;
  agentId: string;
  targetId: string;
}): AgentOwnerApproval {
  const keypair = nacl.sign.keyPair();
  const approvedBy = new PublicKey(keypair.publicKey).toBase58();
  const input = {
    walletName,
    agentId,
    action: "submit_venue_trade" as const,
    summary: "Place Hyperliquid practice trade",
    targetType: "proposal" as const,
    targetId,
    details: [{ label: "Market", value: "BTC-PERP" }],
  };
  const message = ownerApprovalSignableText(input, now);
  return {
    id: `approval-${targetId}`,
    ...input,
    approvalMethod: "wallet_signature",
    approvedBy,
    signature: bytesToHex(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    ),
    approvalHash: `hash-${targetId}`,
    createdAt: now,
    version: 1,
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
