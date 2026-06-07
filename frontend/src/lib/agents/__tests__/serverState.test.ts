import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  agentServerLeaderboard,
  approveAgentServerProposal,
  getAgentServerWalletState,
  hasAgentServerWalletSignedOwnerApproval,
  saveAgentServerExecution,
  saveAgentServerOwnerApproval,
  saveAgentServerProfile,
  saveAgentServerProposal,
  saveAgentServerSession,
  saveAgentServerVaultPolicy,
  setAgentServerEmergencyPause,
  validateAgentServerExecutionHandoff,
} from "@/lib/agents/serverState";
import type {
  AgentProfile,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentSessionGrant,
  AgentTradeProposal,
} from "@/lib/agents/types";

const now = Date.UTC(2026, 5, 1, 12, 0, 0);

function agent(walletName = "server-vault"): AgentProfile {
  return {
    id: "agent-alpha",
    walletName,
    name: "Agent Alpha",
    kind: "mock",
    status: "active",
    strategy: {
      mode: "paper",
      allowedMarkets: ["BTC-PERP", "ETH-PERP"],
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

function session(walletName = "server-vault"): AgentSessionGrant {
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

function proposal(
  id = "proposal-1",
  walletName = "server-vault",
): AgentTradeProposal {
  return {
    id,
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
    thesis: "Momentum breakout.",
    confidence: 72,
    expiresAt: now + 15 * 60 * 1000,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function execution(
  id = "execution-1",
  walletName = "server-vault",
): AgentExecutionRecord {
  return {
    id,
    walletName,
    proposalId: "proposal-1",
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
    status: "open",
    openedAt: now,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
  };
}

function ownerApproval(walletName = "server-vault"): AgentOwnerApproval {
  return {
    id: "approval-1",
    walletName,
    agentId: "agent-alpha",
    action: "grant_allowance",
    summary: "Give practice allowance",
    details: [{ label: "Size", value: "$250" }],
    targetType: "session",
    targetId: "session-1",
    approvalMethod: "browser_confirm",
    approvedBy: null,
    signature: null,
    approvalHash: "hash-1",
    createdAt: now,
    version: 1,
  };
}

function signedOwnerApproval(walletName = "server-vault"): AgentOwnerApproval {
  const keypair = nacl.sign.keyPair();
  const approvedBy = new PublicKey(keypair.publicKey).toBase58();
  const unsigned = ownerApproval(walletName);
  const message = ownerApprovalSignableText(
    {
      walletName: unsigned.walletName,
      agentId: unsigned.agentId,
      action: unsigned.action,
      summary: unsigned.summary,
      details: unsigned.details,
      targetType: unsigned.targetType,
      targetId: unsigned.targetId,
    },
    unsigned.createdAt,
  );
  return {
    ...unsigned,
    approvalMethod: "wallet_signature",
    approvedBy,
    signature: bytesToHex(
      nacl.sign.detached(new TextEncoder().encode(message), keypair.secretKey),
    ),
  };
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("agent backend state persistence", () => {
  it("persists owner approvals once and adds an audit event", async () => {
    const walletName = "server-vault-approvals";

    await saveAgentServerOwnerApproval(ownerApproval(walletName));
    await saveAgentServerOwnerApproval(ownerApproval(walletName));
    const state = await getAgentServerWalletState(walletName);

    expect(state.approvals).toHaveLength(1);
    expect(state.events.filter((event) => event.kind === "owner_action_approved")).toHaveLength(1);
  });

  it("verifies wallet-signed owner approvals for active grants", async () => {
    const walletName = "server-vault-signed-approvals";
    await saveAgentServerOwnerApproval(signedOwnerApproval(walletName));

    await expect(
      saveAgentServerOwnerApproval({
        ...signedOwnerApproval(`${walletName}-bad`),
        walletName,
        signature: "00".repeat(64),
      }),
    ).rejects.toThrow("signature");

    await expect(
      hasAgentServerWalletSignedOwnerApproval({
        walletName,
        agentId: "agent-alpha",
        action: "grant_allowance",
        targetType: "session",
        targetId: "session-1",
      }),
    ).resolves.toBe(true);
  });

  it("persists agents, sessions, proposals, scorecards, and audit events", async () => {
    await saveAgentServerProfile(agent());
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy("server-vault", now),
      cooldownSeconds: 0,
    });
    await saveAgentServerSession(session());

    const saved = await saveAgentServerProposal(proposal());
    const state = await getAgentServerWalletState("server-vault");

    expect(saved.duplicate).toBe(false);
    expect(saved.evaluation?.decision).toBe("allowed");
    expect(saved.proposal.status).toBe("approved");
    expect(saved.proposal.policyHash).toBe(state.policy.policyHash);
    expect(state.sessions[0]?.policyHash).toBe(state.policy.policyHash);
    expect(state.agents).toHaveLength(1);
    expect(state.sessions).toHaveLength(1);
    expect(state.proposals).toHaveLength(1);
    expect(state.scorecards["agent-alpha"]?.proposals).toBe(1);
    expect(state.scorecards["agent-alpha"]?.approved).toBe(1);
    expect(state.events.map((event) => event.kind)).toContain("proposal_created");
    expect(await agentServerLeaderboard("server-vault")).toHaveLength(1);
  });

  it("re-evaluates policy on server save instead of trusting proposal status", async () => {
    const walletName = "server-vault-blocks";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      maxNotionalUsd: "100",
      cooldownSeconds: 0,
    });

    const saved = await saveAgentServerProposal({
      ...proposal("proposal-too-large", walletName),
      status: "approved",
      notionalUsd: "250",
    });

    expect(saved.proposal.status).toBe("blocked");
    expect(saved.evaluation?.decision).toBe("blocked");
    expect(saved.proposal.policyViolations?.map((item) => item.code)).toContain(
      "notional_too_large",
    );
  });

  it("rechecks policy when a human approves a proposal", async () => {
    const walletName = "server-vault-approval";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    const saved = await saveAgentServerProposal({
      ...proposal("proposal-approval", walletName),
      status: "draft",
    });

    await setAgentServerEmergencyPause(walletName, true);
    const approved = await approveAgentServerProposal(walletName, saved.proposal.id);

    expect(approved?.proposal.status).toBe("blocked");
    expect(approved?.proposal.policyViolations?.map((item) => item.code)).toContain(
      "emergency_paused",
    );
  });

  it("deduplicates bot retries by client signal id", async () => {
    const walletName = "server-vault-retries";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    await saveAgentServerSession(session(walletName));

    const first = await saveAgentServerProposal({
      ...proposal("proposal-a", walletName),
      clientSignalId: "retry-1",
    });
    const duplicate = await saveAgentServerProposal({
      ...proposal("proposal-b", walletName),
      clientSignalId: "retry-1",
    });
    const state = await getAgentServerWalletState(walletName);

    expect(first.duplicate).toBe(false);
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.proposal.id).toBe("proposal-a");
    expect(state.proposals).toHaveLength(1);
  });

  it("persists paper executions and uses them for backend risk and scorecards", async () => {
    const walletName = "server-vault-executions";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
      maxOpenPositionsPerAgent: 1,
    });
    await saveAgentServerSession(session(walletName));
    const savedProposal = await saveAgentServerProposal(
      proposal("proposal-1", walletName),
    );

    const opened = await saveAgentServerExecution({
      ...execution("execution-1", walletName),
      policyHash: savedProposal.proposal.policyHash,
    });
    const blocked = await saveAgentServerProposal({
      ...proposal("proposal-2", walletName),
      market: "ETH-PERP",
    });
    const closed = await saveAgentServerExecution({
      ...opened,
      status: "closed",
      closedAt: now + 10_000,
      realizedPnlUsd: "42.5",
    });
    const state = await getAgentServerWalletState(walletName);

    expect(opened.status).toBe("open");
    expect(opened.policyHash).toBe(
      state.proposals.find((item) => item.id === "proposal-1")?.policyHash,
    );
    expect(blocked.proposal.status).toBe("blocked");
    expect(blocked.proposal.policyViolations?.map((item) => item.code)).toContain(
      "too_many_open_positions",
    );
    expect(closed.status).toBe("closed");
    expect(state.executions).toHaveLength(1);
    expect(state.proposals.find((item) => item.id === "proposal-1")?.status).toBe(
      "executed",
    );
    expect(state.scorecards["agent-alpha"]?.executed).toBe(1);
    expect(state.scorecards["agent-alpha"]?.realizedPnlUsd).toBe("42.5");
    expect(state.events.map((event) => event.kind)).toEqual(
      expect.arrayContaining([
        "execution_opened",
        "proposal_executed",
        "execution_closed",
      ]),
    );
  });

  it("replaces older active sessions for the same agent", async () => {
    const walletName = "server-vault-session-replacement";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy(defaultAgentVaultPolicy(walletName, now));
    await saveAgentServerSession(session(walletName));
    await saveAgentServerSession({
      ...session(walletName),
      id: "session-2",
      startsAt: now + 1_000,
      expiresAt: now + 2 * 60 * 60 * 1000,
    });

    const state = await getAgentServerWalletState(walletName);

    expect(state.sessions.filter((item) => item.status === "active")).toHaveLength(1);
    expect(state.sessions.find((item) => item.id === "session-1")?.status).toBe(
      "revoked",
    );
    expect(state.sessions.find((item) => item.id === "session-2")?.status).toBe(
      "active",
    );
  });

  it("rejects fabricated and duplicate backend paper executions", async () => {
    const walletName = "server-vault-execution-gate";
    await saveAgentServerProfile(agent(walletName));
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      cooldownSeconds: 0,
    });
    await saveAgentServerSession(session(walletName));
    const saved = await saveAgentServerProposal(proposal("proposal-1", walletName));
    const valid = {
      ...execution("execution-1", walletName),
      policyHash: saved.proposal.policyHash,
    };

    await expect(
      saveAgentServerExecution({ ...valid, notionalUsd: "999" }),
    ).rejects.toThrow("risk values");

    await saveAgentServerExecution(valid);

    await expect(
      saveAgentServerExecution({ ...valid, id: "execution-2" }),
    ).rejects.toThrow("already has");
  });

  it("gates server venue handoffs with current backend policy", async () => {
    const walletName = "server-vault-handoff";
    await saveAgentServerProfile({
      ...agent(walletName),
      strategy: {
        ...agent(walletName).strategy!,
        mode: "bounded_live",
      },
    });
    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      allowedVenues: ["hyperliquid_testnet"],
      cooldownSeconds: 0,
    });
    const saved = await saveAgentServerProposal({
      ...proposal("proposal-live", walletName),
      venue: "hyperliquid_testnet",
      status: "needs_approval",
    });
    await validateAgentServerExecutionHandoff({
      walletName,
      agentId: "agent-alpha",
      proposalId: saved.proposal.id,
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      approvedAt: now,
    }).then((gate) => {
      expect(gate.allowed).toBe(false);
      expect(gate.message).toContain("approved");
    });

    const approved = await approveAgentServerProposal(walletName, saved.proposal.id);
    const allowed = await validateAgentServerExecutionHandoff({
      walletName,
      agentId: "agent-alpha",
      proposalId: saved.proposal.id,
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      approvedAt: now,
    });

    expect(allowed.allowed).toBe(true);
    expect(allowed.evaluation?.decision).toBe("requires_human_approval");

    await saveAgentServerVaultPolicy({
      ...defaultAgentVaultPolicy(walletName, now),
      allowedVenues: ["hyperliquid_testnet"],
      cooldownSeconds: 0,
      maxSessionHours: 25,
    });
    const changedState = await getAgentServerWalletState(walletName);
    const stale = await validateAgentServerExecutionHandoff({
      walletName,
      agentId: "agent-alpha",
      proposalId: saved.proposal.id,
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      approvedAt: now,
    });

    expect(stale.proposal?.policyHash).toBe(approved?.proposal.policyHash);
    expect(stale.proposal?.policyHash).not.toBe(changedState.policy.policyHash);
    expect(stale.allowed).toBe(false);
    expect(stale.message).toContain("older policy hash");

    const refreshed = await approveAgentServerProposal(walletName, saved.proposal.id);
    const allowedAfterReapproval = await validateAgentServerExecutionHandoff({
      walletName,
      agentId: "agent-alpha",
      proposalId: saved.proposal.id,
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      approvedAt: now,
    });

    expect(refreshed?.proposal.policyHash).not.toBe(approved?.proposal.policyHash);
    expect(allowedAfterReapproval.allowed).toBe(true);

    await setAgentServerEmergencyPause(walletName, true);
    const blocked = await validateAgentServerExecutionHandoff({
      walletName,
      agentId: "agent-alpha",
      proposalId: saved.proposal.id,
      venue: "hyperliquid_testnet",
      market: "BTC-PERP",
      side: "long",
      orderType: "market",
      notionalUsd: "250",
      leverage: 1,
      approvedAt: now,
    });

    expect(blocked.allowed).toBe(false);
    expect(blocked.evaluation?.violations.map((item) => item.code)).toContain(
      "emergency_paused",
    );
  });
});
