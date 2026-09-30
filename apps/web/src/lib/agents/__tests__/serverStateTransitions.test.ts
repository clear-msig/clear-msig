import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  getAgentServerWalletState, rejectAgentServerProposal, saveAgentServerProfile,
  saveAgentServerProposal, saveAgentServerSession, saveAgentServerVaultPolicy,
  updateAgentServerSessionStatus,
} from "@/test/agents/serverState";
import type { AgentSessionGrant, AgentTradeProposal } from "@/lib/agents/types";
import { saveApprovedSession, signedOwnerApproval } from "@/test/agents/signedOwnerApproval";
import { activeSessionFor, emptyState } from "@/features/agents/server/serverStateSupport";

const now = Date.UTC(2026, 5, 1, 12);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });
function session(walletName: string): AgentSessionGrant {
  return { id: "session-1", walletName, agentId: "agent-1", status: "active", startsAt: now,
    expiresAt: now + 3600000, allowedVenues: ["mock_perps"], allowedMarkets: ["BTC-PERP"],
    maxNotionalUsd: "100", maxLeverage: 1, maxOpenPositions: 1, createdAt: now, updatedAt: now, version: 1 };
}
function proposal(walletName: string): AgentTradeProposal {
  return { id: "proposal-1", walletName, agentId: "agent-1", venue: "mock_perps", market: "BTC-PERP",
    side: "long", orderType: "market", notionalUsd: "50", leverage: 1, stopLossPrice: "50000",
    confidence: 50, expiresAt: now + 60000, status: "draft", createdAt: now, updatedAt: now, version: 1 };
}
async function seed(walletName: string) {
  await saveAgentServerProfile({ id: "agent-1", walletName, name: "Test agent", kind: "mock", status: "active",
    createdAt: now, updatedAt: now, version: 1 });
  await saveAgentServerVaultPolicy(defaultAgentVaultPolicy(walletName, now));
}

describe("server agent state transition invariants", () => {
  it("does not use legacy persisted grants as automatic authorization", () => {
    const state = emptyState("transition-legacy-grant");
    state.sessions = [session(state.walletName)];
    const approval = signedOwnerApproval({ walletName: state.walletName, agentId: "agent-1",
      action: "grant_allowance", targetType: "session", targetId: "session-1" });
    state.approvals = [{ ...approval, signatureVersion: undefined }];
    expect(activeSessionFor(state, "agent-1", now)).toBeNull();
    state.approvals = [approval];
    expect(activeSessionFor(state, "agent-1", now)?.id).toBe("session-1");
  });

  it("does not use an allowance before its start time", () => {
    const state = emptyState("transition-future-grant");
    state.sessions = [{ ...session(state.walletName), startsAt: now + 1000 }];
    state.approvals = [signedOwnerApproval({ walletName: state.walletName, agentId: "agent-1",
      action: "grant_allowance", targetType: "session", targetId: "session-1" })];
    expect(activeSessionFor(state, "agent-1", now)).toBeNull();
  });

  it("requires signed approval inside the server for active session creation", async () => {
    await expect(saveAgentServerSession(session("transition-no-signature"))).rejects.toThrow("wallet-signed owner approval");
  });

  it("does not activate an unsigned session through the status-only path", async () => {
    const walletName = "transition-unsigned-resume";
    await saveAgentServerSession({ ...session(walletName), status: "paused" });
    await expect(updateAgentServerSessionStatus({ walletName, id: "session-1", status: "active" })).rejects.toThrow("wallet-signed owner approval");
  });

  it("does not revive revoked sessions through either mutation path", async () => {
    const walletName = "transition-revoked";
    await saveApprovedSession(session(walletName));
    await updateAgentServerSessionStatus({ walletName, id: "session-1", status: "revoked" });
    await expect(updateAgentServerSessionStatus({ walletName, id: "session-1", status: "active" })).rejects.toThrow("terminal");
    await expect(saveAgentServerSession(session(walletName))).rejects.toThrow("terminal");
  });

  it("does not reuse an approval to expand the same session bounds", async () => {
    const walletName = "transition-session-bounds";
    await saveApprovedSession(session(walletName));
    await expect(saveAgentServerSession({ ...session(walletName), maxNotionalUsd: "500" })).rejects.toThrow("immutable");
  });

  it("requires renewal when an active session has expired", async () => {
    const walletName = "transition-expiry";
    await saveApprovedSession(session(walletName));
    vi.setSystemTime(now + 3600000);
    await expect(updateAgentServerSessionStatus({ walletName, id: "session-1", status: "active" })).rejects.toThrow("expired");
  });

  it("resaving a rejected proposal cannot restore an executable status", async () => {
    const walletName = "transition-rejected-proposal";
    await seed(walletName);
    await saveAgentServerProposal(proposal(walletName));
    await rejectAgentServerProposal(walletName, "proposal-1");
    const retry = await saveAgentServerProposal(proposal(walletName));
    expect(retry.proposal.status).toBe("rejected");
    expect((await getAgentServerWalletState(walletName)).proposals[0]?.status).toBe("rejected");
  });

  it("does not substitute trade fields beneath an existing approval target", async () => {
    const walletName = "transition-proposal-bounds";
    await seed(walletName);
    await saveAgentServerProposal(proposal(walletName));
    await expect(saveAgentServerProposal({ ...proposal(walletName), notionalUsd: "200" })).rejects.toThrow("immutable");
  });
});
