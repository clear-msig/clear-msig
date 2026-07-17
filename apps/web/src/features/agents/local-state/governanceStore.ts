"use client";

import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { bindAgentSessionPolicyHash, bindAgentVaultPolicyHash } from "@/lib/agents/policyHash";
import { rankAgents } from "@/lib/agents/scoring";
import type { AgentAuditEvent, AgentLeaderboardEntry, AgentOwnerApproval, AgentScorecard, AgentSessionGrant, AgentVaultPolicy } from "@/lib/agents/types";
import { readAgentState as readAll, writeAgentState as writeAll } from "@/features/agents/local-state/repository";
import { appendEvent, newAgentEventId } from "@/features/agents/local-state/stateSupport";

export function listAgentEvents(walletName: string): AgentAuditEvent[] {
  return [...(readAll().eventsByWallet[walletName] ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function listAgentOwnerApprovals(walletName: string): AgentOwnerApproval[] {
  return [...(readAll().approvalsByWallet[walletName] ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function saveAgentOwnerApproval(
  approval: AgentOwnerApproval,
): AgentOwnerApproval {
  const shape = readAll();
  const list = shape.approvalsByWallet[approval.walletName] ?? [];
  const existingIndex = list.findIndex(
    (item) => item.id === approval.id || item.approvalHash === approval.approvalHash,
  );
  const isNew = existingIndex < 0;
  if (existingIndex >= 0) list[existingIndex] = approval;
  else list.unshift(approval);
  shape.approvalsByWallet[approval.walletName] = list.slice(0, 250);
  if (isNew) {
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName: approval.walletName,
      agentId: approval.agentId,
      kind: "owner_action_approved",
      message: `${approval.summary} approved by owner.`,
      createdAt: approval.createdAt,
      version: 1,
    });
  }
  writeAll(shape);
  return approval;
}

export function listAgentSessions(walletName: string): AgentSessionGrant[] {
  return [...(readAll().sessionsByWallet[walletName] ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function saveAgentSession(session: AgentSessionGrant): AgentSessionGrant {
  const shape = readAll();
  const policy =
    shape.policiesByWallet[session.walletName] ??
    defaultAgentVaultPolicy(session.walletName);
  const boundSession = bindAgentSessionPolicyHash(session, normalizePolicy(policy));
  const now = Date.now();
  const list = (shape.sessionsByWallet[boundSession.walletName] ?? []).map(
    (existing) =>
      boundSession.status === "active" &&
      existing.id !== boundSession.id &&
      existing.agentId === boundSession.agentId &&
      existing.status === "active"
        ? { ...existing, status: "revoked" as const, updatedAt: now }
        : existing,
  );
  const idx = list.findIndex((existing) => existing.id === boundSession.id);
  if (idx >= 0) list[idx] = boundSession;
  else list.push(boundSession);
  shape.sessionsByWallet[boundSession.walletName] = list;
  writeAll(shape);
  return boundSession;
}

export function updateAgentSessionStatus(
  walletName: string,
  id: string,
  status: AgentSessionGrant["status"],
): AgentSessionGrant | null {
  const shape = readAll();
  const list = shape.sessionsByWallet[walletName] ?? [];
  const idx = list.findIndex((session) => session.id === id);
  if (idx < 0) return null;
  const session = list[idx];
  if (!session) return null;
  const now = Date.now();
  const updated: AgentSessionGrant = { ...session, status, updatedAt: now };
  list[idx] = updated;
  shape.sessionsByWallet[walletName] = list;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: session.agentId,
    kind: "session_status_changed",
    message: `Trading session ${sessionStatusEventLabel(status)}.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function renewAgentSession(
  walletName: string,
  id: string,
): AgentSessionGrant | null {
  const shape = readAll();
  const original = (shape.sessionsByWallet[walletName] ?? []).find(
    (session) => session.id === id,
  );
  if (!original) return null;
  const agent = (shape.agentsByWallet[walletName] ?? []).find(
    (item) => item.id === original.agentId,
  );
  if (!agent || agent.status !== "active") return null;
  const now = Date.now();
  const policy =
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName, now);
  const originalDuration = Math.max(
    60 * 60 * 1000,
    original.expiresAt - original.startsAt,
  );
  const maxDuration =
    policy.maxSessionHours > 0
      ? policy.maxSessionHours * 60 * 60 * 1000
      : originalDuration;
  const renewed: AgentSessionGrant = {
    ...original,
    id: newAgentSessionId(),
    status: "active",
    startsAt: now,
    expiresAt: now + Math.min(originalDuration, maxDuration),
    createdAt: now,
    updatedAt: now,
  };
  const boundRenewed = bindAgentSessionPolicyHash(
    renewed,
    normalizePolicy(policy),
  );
  shape.sessionsByWallet[walletName] = (
    shape.sessionsByWallet[walletName] ?? []
  ).map((session) =>
    session.agentId === boundRenewed.agentId && session.status === "active"
      ? { ...session, status: "revoked", updatedAt: now }
      : session,
  );
  shape.sessionsByWallet[walletName].push(boundRenewed);
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: boundRenewed.agentId,
    kind: "session_renewed",
    message: "Trading session renewed.",
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return boundRenewed;
}

export function listAgentScorecards(walletName: string): AgentScorecard[] {
  return Object.values(readAll().scorecardsByWallet[walletName] ?? {});
}

export function agentLeaderboard(walletName: string): AgentLeaderboardEntry[] {
  return rankAgents(listAgentScorecards(walletName));
}

export function newAgentId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function newAgentProposalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_proposal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function newAgentSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_session_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function normalizePolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
  });
}

function sessionStatusEventLabel(status: AgentSessionGrant["status"]): string {
  switch (status) {
    case "active": return "resumed";
    case "paused": return "paused";
    case "expired": return "expired";
    case "revoked": return "revoked";
  }
}
