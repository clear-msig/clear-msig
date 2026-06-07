import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { POST as mutateAgentState } from "@/app/api/agent-state/[name]/route";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  saveAgentServerExecution,
  saveAgentServerOwnerApproval,
  saveAgentServerProfile,
  saveAgentServerProposal,
  saveAgentServerSession,
  saveAgentServerVaultPolicy,
} from "@/lib/agents/serverState";
import type {
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agent state route owner authority", () => {
  it("requires wallet approval before closing a durable trade record", async () => {
    const walletName = "route-state-close-no-approval";
    const opened = await seedOpenExecution(walletName);

    const response = await mutateAgentState(
      request(walletName, { ...opened, status: "closed", realizedPnlUsd: "12.5", closedAt: now }),
      { params: Promise.resolve({ name: walletName }) },
    );
    const body = (await response.json()) as { error?: string };

    expect(response.status).toBe(409);
    expect(body.error).toContain("wallet approval");
  });

  it("accepts a close after the wallet approval is verified", async () => {
    const walletName = "route-state-close-approved";
    const opened = await seedOpenExecution(walletName);
    await saveAgentServerOwnerApproval(
      signedApproval({
        walletName,
        agentId: opened.agentId,
        targetId: opened.id,
      }),
    );

    const response = await mutateAgentState(
      request(walletName, { ...opened, status: "closed", realizedPnlUsd: "12.5", closedAt: now }),
      { params: Promise.resolve({ name: walletName }) },
    );
    const body = (await response.json()) as {
      execution?: AgentExecutionRecord;
    };

    expect(response.status).toBe(200);
    expect(body.execution?.status).toBe("closed");
    expect(body.execution?.realizedPnlUsd).toBe("12.5");
  });
});

async function seedOpenExecution(walletName: string): Promise<AgentExecutionRecord> {
  await saveAgentServerProfile(agent(walletName));
  await saveAgentServerVaultPolicy({
    ...defaultAgentVaultPolicy(walletName, now),
    cooldownSeconds: 0,
  });
  await saveAgentServerSession(session(walletName));
  const saved = await saveAgentServerProposal(proposal(walletName));
  return saveAgentServerExecution({
    id: "execution-1",
    walletName,
    proposalId: saved.proposal.id,
    agentId: "agent-alpha",
    venue: "mock_perps",
    market: "BTC-PERP",
    side: "long",
    orderType: "market",
    notionalUsd: "250",
    leverage: 1,
    executionMode: "paper",
    adapterStatus: "ready",
    externalOrderId: null,
    policyHash: saved.proposal.policyHash,
    status: "open",
    openedAt: now,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
  });
}

function request(walletName: string, execution: AgentExecutionRecord): NextRequest {
  return new NextRequest(`http://localhost/api/agent-state/${walletName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "localhost",
      Origin: "http://localhost",
    },
    body: JSON.stringify({ action: "upsert_execution", payload: execution }),
  });
}

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

function proposal(walletName: string): AgentTradeProposal {
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
    takeProfitPrice: null,
    confidence: 72,
    expiresAt: now + 15 * 60 * 1000,
    status: "draft",
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
    action: "close_practice_trade" as const,
    summary: "Close practice trade",
    targetType: "execution" as const,
    targetId,
    details: [{ label: "Trade", value: "BTC-PERP long" }],
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
