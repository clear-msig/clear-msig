"use client";

import {
  agentExecutionAdapter,
  canOpenLocalAgentExecution,
  executionModeForVenue,
} from "@/lib/agents/executionAdapters";
import { buildAgentPostTradeReview } from "@/lib/agents/postTradeReview";
import { evaluateAgentTradeProposal } from "@/lib/agents/policy";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  bindAgentExecutionPolicyHash,
  bindAgentProposalPolicyHash,
  bindAgentSessionPolicyHash,
  bindAgentVaultPolicyHash,
} from "@/lib/agents/policyHash";
import { rankAgents } from "@/lib/agents/scoring";
import type {
  AgentAuditEvent,
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentLeaderboardEntry,
  AgentOwnerApproval,
  AgentPolicyEvaluation,
  AgentProposalStatus,
  AgentProfile,
  AgentRiskSnapshot,
  AgentScorecard,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

const STORAGE_KEY = "clear.agents.v1";
const CHANGE_EVENT = "clear:agents-changed";

interface StoredShape {
  agentsByWallet: Record<string, AgentProfile[]>;
  policiesByWallet: Record<string, AgentVaultPolicy>;
  proposalsByWallet: Record<string, AgentTradeProposal[]>;
  sessionsByWallet: Record<string, AgentSessionGrant[]>;
  executionsByWallet: Record<string, AgentExecutionRecord[]>;
  eventsByWallet: Record<string, AgentAuditEvent[]>;
  scorecardsByWallet: Record<string, Record<string, AgentScorecard>>;
  connectionsByWallet: Record<string, Record<string, AgentConnectionKit>>;
  approvalsByWallet: Record<string, AgentOwnerApproval[]>;
  version: 1;
}

function emptyShape(): StoredShape {
  return {
    agentsByWallet: {},
    policiesByWallet: {},
    proposalsByWallet: {},
    sessionsByWallet: {},
    executionsByWallet: {},
    eventsByWallet: {},
    scorecardsByWallet: {},
    connectionsByWallet: {},
    approvalsByWallet: {},
    version: 1,
  };
}

function readAll(): StoredShape {
  const empty = emptyShape();
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    if ((parsed as StoredShape).version !== 1) return empty;
    return { ...empty, ...(parsed as StoredShape), version: 1 };
  } catch {
    return empty;
  }
}

function writeAll(shape: StoredShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* localStorage quota/private-mode failures should not break the app */
  }
}

export function subscribeAgents(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function listAgents(walletName: string): AgentProfile[] {
  return [...(readAll().agentsByWallet[walletName] ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

export function findAgent(walletName: string, id: string): AgentProfile | null {
  return listAgents(walletName).find((agent) => agent.id === id) ?? null;
}

export function saveAgent(agent: AgentProfile): AgentProfile {
  const shape = readAll();
  const list = shape.agentsByWallet[agent.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === agent.id);
  if (idx >= 0) list[idx] = agent;
  else list.push(agent);
  shape.agentsByWallet[agent.walletName] = list;
  shape.scorecardsByWallet[agent.walletName] ??= {};
  shape.scorecardsByWallet[agent.walletName][agent.id] ??= blankScorecard(agent);
  writeAll(shape);
  return agent;
}

export function getAgentConnectionKit(
  walletName: string,
  agentId: string,
): AgentConnectionKit {
  const shape = readAll();
  shape.connectionsByWallet[walletName] ??= {};
  const existing = shape.connectionsByWallet[walletName][agentId];
  if (existing) {
    if (!existing.managementKey || existing.autoImportSessionSignals == null) {
      const updated = {
        ...existing,
        managementKey: existing.managementKey ?? newConnectionManagementKey(),
        autoImportSessionSignals: existing.autoImportSessionSignals ?? false,
      };
      shape.connectionsByWallet[walletName][agentId] = updated;
      writeAll(shape);
      return updated;
    }
    return existing;
  }
  const now = Date.now();
  const kit: AgentConnectionKit = {
    walletName,
    agentId,
    signalKey: newSignalKey(),
    managementKey: newConnectionManagementKey(),
    autoImportSessionSignals: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  shape.connectionsByWallet[walletName][agentId] = kit;
  writeAll(shape);
  return kit;
}

export function listAgentConnectionKits(walletName: string): AgentConnectionKit[] {
  return Object.values(readAll().connectionsByWallet[walletName] ?? {}).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function rotateAgentSignalKey(
  walletName: string,
  agentId: string,
): AgentConnectionKit | null {
  const shape = readAll();
  const agent = (shape.agentsByWallet[walletName] ?? []).find(
    (item) => item.id === agentId,
  );
  if (!agent) return null;
  const now = Date.now();
  const kit: AgentConnectionKit = {
    walletName,
    agentId,
    signalKey: newSignalKey(),
    managementKey:
      shape.connectionsByWallet[walletName]?.[agentId]?.managementKey ??
      newConnectionManagementKey(),
    autoImportSessionSignals:
      shape.connectionsByWallet[walletName]?.[agentId]?.autoImportSessionSignals ??
      false,
    createdAt:
      shape.connectionsByWallet[walletName]?.[agentId]?.createdAt ?? now,
    updatedAt: now,
    version: 1,
  };
  shape.connectionsByWallet[walletName] ??= {};
  shape.connectionsByWallet[walletName][agentId] = kit;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId,
    kind: "connection_key_rotated",
    message: `${agent.name} signal key rotated.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return kit;
}

export function updateAgentConnectionSettings(
  walletName: string,
  agentId: string,
  settings: Pick<AgentConnectionKit, "autoImportSessionSignals">,
): AgentConnectionKit | null {
  const shape = readAll();
  const existing = shape.connectionsByWallet[walletName]?.[agentId];
  if (!existing) return null;
  const updated: AgentConnectionKit = {
    ...existing,
    managementKey: existing.managementKey ?? newConnectionManagementKey(),
    autoImportSessionSignals: settings.autoImportSessionSignals,
    updatedAt: Date.now(),
  };
  shape.connectionsByWallet[walletName] ??= {};
  shape.connectionsByWallet[walletName][agentId] = updated;
  writeAll(shape);
  return updated;
}

export function updateAgentStatus(
  walletName: string,
  id: string,
  status: AgentProfile["status"],
): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent) return null;
  const now = Date.now();
  const updated: AgentProfile = { ...agent, status, updatedAt: now };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  if (status !== "active") {
    shape.sessionsByWallet[walletName] = (shape.sessionsByWallet[walletName] ?? []).map(
      (session) =>
        session.agentId === id && session.status === "active"
          ? { ...session, status: "revoked", updatedAt: now }
          : session,
    );
  }
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_status_changed",
    message: `${agent.name} ${agentStatusEventLabel(status)}.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function publishAgentProfile(
  walletName: string,
  id: string,
  publicSummary?: string,
): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent) return null;
  const now = Date.now();
  const slug =
    agent.publishing?.slug ??
    `${slugPart(agent.name || "agent")}-${slugPart(agent.id)}`;
  const updated: AgentProfile = {
    ...agent,
    publishing: {
      status: "published",
      slug,
      publicSummary:
        publicSummary?.trim() ||
        agent.publishing?.publicSummary ||
        agent.description?.trim() ||
        `${agent.name} trading profile`,
      visibleMetrics: [
        "score",
        "realized_pnl",
        "closed_trades",
        "open_trades",
        "win_rate",
        "safety_stops",
        "allocation_tier",
      ],
      publishedAt: agent.publishing?.publishedAt ?? now,
      updatedAt: now,
      version: 1,
    },
    updatedAt: now,
  };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_profile_published",
    message: `${agent.name} publishing profile turned on.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function unpublishAgentProfile(
  walletName: string,
  id: string,
): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent) return null;
  const now = Date.now();
  const updated: AgentProfile = {
    ...agent,
    publishing: {
      status: "draft",
      slug:
        agent.publishing?.slug ??
        `${slugPart(agent.name || "agent")}-${slugPart(agent.id)}`,
      publicSummary:
        agent.publishing?.publicSummary ||
        agent.description?.trim() ||
        `${agent.name} trading profile`,
      visibleMetrics:
        agent.publishing?.visibleMetrics ?? [
          "score",
          "realized_pnl",
          "closed_trades",
          "open_trades",
          "win_rate",
          "safety_stops",
          "allocation_tier",
        ],
      publishedAt: agent.publishing?.publishedAt,
      updatedAt: now,
      version: 1,
    },
    updatedAt: now,
  };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_profile_unpublished",
    message: `${agent.name} publishing profile turned off.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function getAgentVaultPolicy(walletName: string): AgentVaultPolicy {
  return normalizePolicy(
    readAll().policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName),
  );
}

export function saveAgentVaultPolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  const shape = readAll();
  const updated = normalizePolicy(policy);
  shape.policiesByWallet[policy.walletName] = updated;
  writeAll(shape);
  return updated;
}

export function setAgentVaultEmergencyPause(
  walletName: string,
  emergencyPaused: boolean,
): AgentVaultPolicy {
  const shape = readAll();
  const current = normalizePolicy(
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName),
  );
  const updated: AgentVaultPolicy = {
    ...current,
    emergencyPaused,
    updatedAt: Date.now(),
  };
  const bound = normalizePolicy(updated);
  shape.policiesByWallet[walletName] = bound;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    kind: "policy_emergency_pause_changed",
    message: emergencyPaused
      ? "Agent Trading kill switch turned on."
      : "Agent Trading kill switch turned off.",
    createdAt: bound.updatedAt,
    version: 1,
  });
  writeAll(shape);
  return bound;
}

export function listAgentProposals(walletName: string): AgentTradeProposal[] {
  return [...(readAll().proposalsByWallet[walletName] ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function findAgentProposal(
  walletName: string,
  id: string,
): AgentTradeProposal | null {
  return listAgentProposals(walletName).find((proposal) => proposal.id === id) ?? null;
}

export function saveAgentProposal(proposal: AgentTradeProposal): AgentTradeProposal {
  const shape = readAll();
  const policy =
    shape.policiesByWallet[proposal.walletName] ??
    defaultAgentVaultPolicy(proposal.walletName);
  const boundProposal = bindAgentProposalPolicyHash(proposal, normalizePolicy(policy));
  const list = shape.proposalsByWallet[proposal.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === boundProposal.id);
  const duplicateIdx = findDuplicateClientSignalIndex(list, boundProposal);
  if (idx < 0 && duplicateIdx >= 0) {
    return list[duplicateIdx] ?? boundProposal;
  }
  if (idx >= 0) list[idx] = boundProposal;
  else {
    list.push(boundProposal);
    updateScorecardForNewProposal(shape, boundProposal);
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName: boundProposal.walletName,
      agentId: boundProposal.agentId,
      proposalId: boundProposal.id,
      kind: "proposal_created",
      message: `${boundProposal.market} ${boundProposal.side} trade signal saved.`,
      createdAt: Date.now(),
      version: 1,
    });
  }
  shape.proposalsByWallet[boundProposal.walletName] = list;
  writeAll(shape);
  return boundProposal;
}

export function approveAgentProposal(
  walletName: string,
  id: string,
): AgentTradeProposal | null {
  return transitionAgentProposal(walletName, id, "approved", "proposal_approved");
}

export function rejectAgentProposal(
  walletName: string,
  id: string,
): AgentTradeProposal | null {
  return transitionAgentProposal(walletName, id, "rejected", "proposal_rejected");
}

export function recheckAgentProposal(
  walletName: string,
  id: string,
): {
  proposal: AgentTradeProposal;
  evaluation: AgentPolicyEvaluation;
  execution: AgentExecutionRecord | null;
} | null {
  const shape = readAll();
  const list = shape.proposalsByWallet[walletName] ?? [];
  const idx = list.findIndex((proposal) => proposal.id === id);
  if (idx < 0) return null;
  const proposal = list[idx];
  if (!proposal || proposal.status === "executed" || proposal.status === "rejected") {
    return null;
  }
  const agent = (shape.agentsByWallet[walletName] ?? []).find(
    (item) => item.id === proposal.agentId,
  );
  if (!agent) return null;
  const now = Date.now();
  const session = activeSessionFor(shape, walletName, proposal.agentId, now);
  const policy = normalizePolicy(
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName, now),
  );
  const proposalForPolicy = bindAgentProposalPolicyHash(proposal, policy);
  const evaluation = evaluateAgentTradeProposal({
    agent,
    proposal: proposalForPolicy,
    policy,
    session,
    risk: riskSnapshotFromShape(shape, walletName, proposal.agentId),
    now,
  });
  const status = statusForEvaluation(evaluation);
  const updatedBase: AgentTradeProposal = {
    ...proposalForPolicy,
    status,
    evaluationDecision: evaluation.decision,
    policyViolations: evaluation.violations,
    updatedAt: now,
  };
  const execution =
    status === "approved" ? executionFromProposal(updatedBase, now) : null;
  const updated: AgentTradeProposal = {
    ...updatedBase,
    status: execution ? "executed" : status,
  };
  list[idx] = updated;
  shape.proposalsByWallet[walletName] = list;
  updateScorecardForStatusChange(shape, proposal, updated);
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    kind: "proposal_rechecked",
    message:
      evaluation.decision === "blocked"
        ? `${proposal.market} ${proposal.side} trade signal is still blocked.`
        : `${proposal.market} ${proposal.side} trade signal passed risk recheck.`,
    createdAt: now,
    version: 1,
  });
  if (execution) {
    shape.executionsByWallet[walletName] ??= [];
    shape.executionsByWallet[walletName].push(execution);
    appendExecutionEvents(shape, updated, execution, now);
  }
  writeAll(shape);
  return { proposal: updated, evaluation, execution };
}

export function executeMockAgentProposal(
  walletName: string,
  id: string,
): AgentExecutionRecord | null {
  return openAgentPaperTrade(walletName, id).execution;
}

export type AgentPaperTradeOpenReason =
  | "opened"
  | "not_found"
  | "already_open"
  | "not_approved"
  | "blocked"
  | "backend_required";

export interface AgentPaperTradeOpenResult {
  proposal: AgentTradeProposal | null;
  evaluation: AgentPolicyEvaluation | null;
  execution: AgentExecutionRecord | null;
  reason: AgentPaperTradeOpenReason;
}

export function openAgentPaperTrade(
  walletName: string,
  id: string,
): AgentPaperTradeOpenResult {
  const shape = readAll();
  const list = shape.proposalsByWallet[walletName] ?? [];
  const idx = list.findIndex((proposal) => proposal.id === id);
  if (idx < 0) {
    return {
      proposal: null,
      evaluation: null,
      execution: null,
      reason: "not_found",
    };
  }
  const proposal = list[idx];
  if (!proposal) {
    return {
      proposal: null,
      evaluation: null,
      execution: null,
      reason: "not_found",
    };
  }
  if (proposal.status === "executed") {
    return {
      proposal,
      evaluation: null,
      execution: null,
      reason: "already_open",
    };
  }
  if (proposal.status === "rejected") {
    return {
      proposal,
      evaluation: null,
      execution: null,
      reason: "not_approved",
    };
  }
  const now = Date.now();
  const policy = currentPolicyForShape(shape, walletName, now);
  const proposalForPolicy = bindAgentProposalPolicyHash(proposal, policy);
  const evaluation = evaluateProposalForCurrentRisk(shape, proposalForPolicy, now);
  if (!evaluation || evaluation.decision === "blocked") {
    const updated = {
      ...proposalForPolicy,
      status: "blocked" as AgentProposalStatus,
      evaluationDecision: evaluation?.decision ?? "blocked",
      policyViolations: evaluation?.violations ?? [
        {
          code: "agent_not_active",
          message: "Trading agent was not found.",
          severity: "block",
        },
      ],
      updatedAt: now,
    };
    list[idx] = updated;
    shape.proposalsByWallet[walletName] = list;
    updateScorecardForStatusChange(shape, proposal, updated);
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName,
      agentId: proposal.agentId,
      proposalId: proposal.id,
      kind: "proposal_rechecked",
      message: `${proposal.market} ${proposal.side} trade signal is blocked by risk limits.`,
      createdAt: now,
      version: 1,
    });
    writeAll(shape);
    return {
      proposal: updated,
      evaluation,
      execution: null,
      reason: "blocked",
    };
  }
  if (
    evaluation.decision === "requires_human_approval" &&
    proposal.status !== "approved"
  ) {
    const updated = {
      ...proposalForPolicy,
      status: "needs_approval" as AgentProposalStatus,
      evaluationDecision: evaluation.decision,
      policyViolations: evaluation.violations,
      updatedAt: now,
    };
    list[idx] = updated;
    shape.proposalsByWallet[walletName] = list;
    updateScorecardForStatusChange(shape, proposal, updated);
    writeAll(shape);
    return {
      proposal: updated,
      evaluation,
      execution: null,
      reason: "not_approved",
    };
  }
  const execution = executionFromProposal(proposalForPolicy, now);
  if (!execution) {
    const updated = {
      ...proposalForPolicy,
      status: "approved" as AgentProposalStatus,
      evaluationDecision: evaluation.decision,
      policyViolations: evaluation.violations,
      updatedAt: now,
    };
    list[idx] = updated;
    shape.proposalsByWallet[walletName] = list;
    writeAll(shape);
    return {
      proposal: updated,
      evaluation,
      execution: null,
      reason: "backend_required",
    };
  }
  const updated = {
    ...proposalForPolicy,
    status: "executed" as AgentProposalStatus,
    evaluationDecision: evaluation.decision,
    policyViolations: evaluation.violations,
    updatedAt: now,
  };
  list[idx] = updated;
  shape.proposalsByWallet[walletName] = list;
  shape.executionsByWallet[walletName] ??= [];
  shape.executionsByWallet[walletName].push(execution);
  updateScorecardForStatusChange(shape, proposal, updated);
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    executionId: execution.id,
    kind: "proposal_executed",
    message: `${proposal.market} ${proposal.side} paper trade opened.`,
    createdAt: now,
    version: 1,
  });
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    executionId: execution.id,
    kind: "execution_opened",
    message: `Paper trade opened for $${proposal.notionalUsd} at ${proposal.leverage}x.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return {
    proposal: updated,
    evaluation,
    execution,
    reason: "opened",
  };
}

export function saveAgentProposalAndExecuteIfAllowed(
  proposal: AgentTradeProposal,
): { proposal: AgentTradeProposal; execution: AgentExecutionRecord | null } {
  const shape = readAll();
  const policy =
    shape.policiesByWallet[proposal.walletName] ??
    defaultAgentVaultPolicy(proposal.walletName);
  const boundProposal = bindAgentProposalPolicyHash(
    proposal,
    normalizePolicy(policy),
  );
  const list = shape.proposalsByWallet[boundProposal.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === boundProposal.id);
  const duplicateIdx = findDuplicateClientSignalIndex(list, boundProposal);
  if (idx < 0 && duplicateIdx >= 0) {
    return { proposal: list[duplicateIdx] ?? boundProposal, execution: null };
  }
  const now = Date.now();
  const execution =
    boundProposal.status === "approved" && canExecuteProposal(shape, boundProposal)
      ? executionFromProposal(boundProposal, now)
      : null;
  const savedProposal = execution
    ? {
        ...boundProposal,
        status: "executed" as AgentProposalStatus,
        updatedAt: now,
      }
    : boundProposal;
  if (idx >= 0) list[idx] = savedProposal;
  else {
    list.push(savedProposal);
    updateScorecardForNewProposal(shape, savedProposal);
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName: savedProposal.walletName,
      agentId: savedProposal.agentId,
      proposalId: savedProposal.id,
      kind: "proposal_created",
      message: `${savedProposal.market} ${savedProposal.side} trade signal saved.`,
      createdAt: now,
      version: 1,
    });
  }
  shape.proposalsByWallet[boundProposal.walletName] = list;
  if (execution) {
    shape.executionsByWallet[boundProposal.walletName] ??= [];
    shape.executionsByWallet[boundProposal.walletName].push(execution);
    appendExecutionEvents(shape, savedProposal, execution, now);
  }
  writeAll(shape);
  return { proposal: savedProposal, execution };
}

export function listAgentExecutions(walletName: string): AgentExecutionRecord[] {
  return [...(readAll().executionsByWallet[walletName] ?? [])].sort(
    (a, b) => b.openedAt - a.openedAt,
  );
}

export function closeMockAgentExecution(
  walletName: string,
  id: string,
  realizedPnlUsd: string,
): AgentExecutionRecord | null {
  const shape = readAll();
  const list = shape.executionsByWallet[walletName] ?? [];
  const idx = list.findIndex((execution) => execution.id === id);
  if (idx < 0) return null;
  const execution = list[idx];
  if (!execution || execution.status === "closed") return execution ?? null;
  const now = Date.now();
  const pnl = normalizePnl(realizedPnlUsd);
  const proposal = findExecutionProposal(shape, walletName, execution);
  const updated: AgentExecutionRecord = {
    ...execution,
    status: "closed",
    closedAt: now,
    realizedPnlUsd: pnl,
    postTradeReview: buildAgentPostTradeReview({
      execution,
      proposal,
      realizedPnlUsd: pnl,
      now,
    }),
  };
  list[idx] = updated;
  shape.executionsByWallet[walletName] = list;
  updateScorecardForClosedExecution(shape, updated);
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: execution.agentId,
    proposalId: execution.proposalId,
    executionId: execution.id,
    kind: "execution_closed",
    message: `${execution.market} ${execution.side} paper trade closed at ${formatSignedUsd(pnl)} PnL.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function closeOpenMockAgentExecutions({
  walletName,
  agentId,
  realizedPnlUsd = "0",
}: {
  walletName: string;
  agentId?: string;
  realizedPnlUsd?: string;
}): AgentExecutionRecord[] {
  const shape = readAll();
  const list = shape.executionsByWallet[walletName] ?? [];
  const now = Date.now();
  const pnl = normalizePnl(realizedPnlUsd);
  const closed: AgentExecutionRecord[] = [];
  const proposals = shape.proposalsByWallet[walletName] ?? [];
  shape.executionsByWallet[walletName] = list.map((execution) => {
    if (
      execution.status !== "open" ||
      (agentId && execution.agentId !== agentId)
    ) {
      return execution;
    }
    const updated: AgentExecutionRecord = {
      ...execution,
      status: "closed",
      closedAt: now,
      realizedPnlUsd: pnl,
      postTradeReview: buildAgentPostTradeReview({
        execution,
        proposal: proposals.find((item) => item.id === execution.proposalId),
        realizedPnlUsd: pnl,
        now,
      }),
    };
    closed.push(updated);
    updateScorecardForClosedExecution(shape, updated);
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName,
      agentId: execution.agentId,
      proposalId: execution.proposalId,
      executionId: execution.id,
      kind: "execution_closed",
      message: `${execution.market} ${execution.side} paper trade closed at ${formatSignedUsd(pnl)} PnL.`,
      createdAt: now,
      version: 1,
    });
    return updated;
  });
  if (closed.length > 0) {
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName,
      agentId,
      kind: "execution_bulk_closed",
      message: agentId
        ? `${closed.length} open paper trade${closed.length === 1 ? "" : "s"} closed for this agent.`
        : `${closed.length} open paper trade${closed.length === 1 ? "" : "s"} closed across the vault.`,
      createdAt: now,
      version: 1,
    });
  }
  writeAll(shape);
  return closed;
}

export function agentRiskSnapshot(walletName: string, agentId: string): AgentRiskSnapshot {
  const executions = readAll().executionsByWallet[walletName] ?? [];
  const agentExecutions = executions.filter((execution) => execution.agentId === agentId);
  const openPositions = agentExecutions.filter((execution) => execution.status === "open").length;
  const lastTradeAt = agentExecutions.reduce<number | null>(
    (latest, execution) => (latest == null || execution.openedAt > latest ? execution.openedAt : latest),
    null,
  );
  const realizedPnl = agentExecutions
    .filter((execution) => execution.status === "closed")
    .reduce((sum, execution) => sum + Number(execution.realizedPnlUsd || 0), 0);
  const dailyPnl = dailyRealizedPnl(agentExecutions, Date.now());
  return {
    openPositions,
    lastTradeAt,
    realizedPnlUsd: String(roundMoney(realizedPnl)),
    dailyRealizedPnlUsd: String(roundMoney(dailyPnl)),
  };
}

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

function newAgentExecutionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_execution_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function findDuplicateClientSignalIndex(
  list: AgentTradeProposal[],
  proposal: AgentTradeProposal,
): number {
  const clientSignalId = proposal.clientSignalId?.trim();
  if (!clientSignalId) return -1;
  return list.findIndex(
    (existing) =>
      existing.id !== proposal.id &&
      existing.walletName === proposal.walletName &&
      existing.agentId === proposal.agentId &&
      existing.clientSignalId === clientSignalId,
  );
}

function newSignalKey(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return `cs_sig_${Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return `cs_sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function newConnectionManagementKey(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return `cs_mgmt_${Array.from(bytes)
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")}`;
  }
  return `cs_mgmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function executionFromProposal(
  proposal: AgentTradeProposal,
  now: number,
): AgentExecutionRecord | null {
  if (!canOpenLocalAgentExecution(proposal.venue)) return null;
  const adapter = agentExecutionAdapter(proposal.venue);
  return bindAgentExecutionPolicyHash({
    id: newAgentExecutionId(),
    walletName: proposal.walletName,
    proposalId: proposal.id,
    agentId: proposal.agentId,
    venue: proposal.venue,
    market: proposal.market,
    side: proposal.side,
    orderType: proposal.orderType,
    notionalUsd: proposal.notionalUsd,
    leverage: proposal.leverage,
    entryPrice: proposal.entryPrice ?? null,
    executionMode: executionModeForVenue(proposal.venue),
    adapterStatus: adapter.status,
    externalOrderId: null,
    status: "open",
    openedAt: now,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
  }, proposal);
}

function findExecutionProposal(
  shape: StoredShape,
  walletName: string,
  execution: AgentExecutionRecord,
): AgentTradeProposal | undefined {
  return (shape.proposalsByWallet[walletName] ?? []).find(
    (proposal) => proposal.id === execution.proposalId,
  );
}

function canExecuteProposal(shape: StoredShape, proposal: AgentTradeProposal): boolean {
  const evaluation = evaluateProposalForCurrentRisk(shape, proposal, Date.now());
  return evaluation?.decision === "allowed";
}

function evaluateProposalForCurrentRisk(
  shape: StoredShape,
  proposal: AgentTradeProposal,
  now: number,
): AgentPolicyEvaluation | null {
  const agent = (shape.agentsByWallet[proposal.walletName] ?? []).find(
    (item) => item.id === proposal.agentId,
  );
  if (!agent) return null;
  const session = activeSessionFor(shape, proposal.walletName, proposal.agentId, now);
  const policy = currentPolicyForShape(shape, proposal.walletName, now);
  return evaluateAgentTradeProposal({
    agent,
    proposal,
    policy,
    session,
    risk: riskSnapshotFromShape(shape, proposal.walletName, proposal.agentId),
    now,
  });
}

function currentPolicyForShape(
  shape: StoredShape,
  walletName: string,
  now = Date.now(),
): AgentVaultPolicy {
  return normalizePolicy(
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName, now),
  );
}

function activeSessionFor(
  shape: StoredShape,
  walletName: string,
  agentId: string,
  now: number,
): AgentSessionGrant | null {
  return (
    (shape.sessionsByWallet[walletName] ?? []).find(
      (item) =>
        item.agentId === agentId &&
        item.status === "active" &&
        item.expiresAt > now,
    ) ?? null
  );
}

function statusForEvaluation(evaluation: AgentPolicyEvaluation): AgentProposalStatus {
  switch (evaluation.decision) {
    case "blocked":
      return "blocked";
    case "allowed":
      return "approved";
    case "requires_human_approval":
      return "needs_approval";
  }
}

function appendExecutionEvents(
  shape: StoredShape,
  proposal: AgentTradeProposal,
  execution: AgentExecutionRecord,
  now: number,
): void {
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName: proposal.walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    executionId: execution.id,
    kind: "proposal_executed",
    message: `${proposal.market} ${proposal.side} paper trade opened.`,
    createdAt: now,
    version: 1,
  });
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName: proposal.walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    executionId: execution.id,
    kind: "execution_opened",
    message: `Paper trade opened for $${proposal.notionalUsd} at ${proposal.leverage}x.`,
    createdAt: now,
    version: 1,
  });
}

function newAgentEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_event_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function normalizePolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
  });
}

function blankScorecard(agent: AgentProfile): AgentScorecard {
  return {
    walletName: agent.walletName,
    agentId: agent.id,
    proposals: 0,
    approved: 0,
    rejected: 0,
    blocked: 0,
    executed: 0,
    ruleViolations: 0,
    realizedPnlUsd: "0",
    maxDrawdownPct: 0,
    humanOverrideCount: 0,
    updatedAt: Date.now(),
    version: 1,
  };
}

function blankScorecardForProposal(proposal: AgentTradeProposal): AgentScorecard {
  return {
    walletName: proposal.walletName,
    agentId: proposal.agentId,
    proposals: 0,
    approved: 0,
    rejected: 0,
    blocked: 0,
    executed: 0,
    ruleViolations: 0,
    realizedPnlUsd: "0",
    maxDrawdownPct: 0,
    humanOverrideCount: 0,
    updatedAt: Date.now(),
    version: 1,
  };
}

function updateScorecardForNewProposal(
  shape: StoredShape,
  proposal: AgentTradeProposal,
): void {
  shape.scorecardsByWallet[proposal.walletName] ??= {};
  const scorecard =
    shape.scorecardsByWallet[proposal.walletName][proposal.agentId] ??
    blankScorecardForProposal(proposal);
  scorecard.proposals += 1;
  scorecard.ruleViolations += proposal.policyViolations?.length ?? 0;
  scorecard.updatedAt = Date.now();
  switch (proposal.status) {
    case "approved":
      scorecard.approved += 1;
      break;
    case "rejected":
      scorecard.rejected += 1;
      break;
    case "blocked":
      scorecard.blocked += 1;
      break;
    case "executed":
      scorecard.executed += 1;
      scorecard.approved += 1;
      break;
    default:
      break;
  }
  shape.scorecardsByWallet[proposal.walletName][proposal.agentId] = scorecard;
}

function transitionAgentProposal(
  walletName: string,
  id: string,
  status: AgentProposalStatus,
  eventKind: Extract<AgentAuditEvent["kind"], "proposal_approved" | "proposal_rejected">,
): AgentTradeProposal | null {
  const shape = readAll();
  const list = shape.proposalsByWallet[walletName] ?? [];
  const idx = list.findIndex((proposal) => proposal.id === id);
  if (idx < 0) return null;
  const proposal = list[idx];
  if (!proposal || proposal.status === status || proposal.status === "executed") {
    return proposal ?? null;
  }
  const policy = currentPolicyForShape(shape, walletName);
  const updated = bindAgentProposalPolicyHash(
    { ...proposal, status, updatedAt: Date.now() },
    policy,
  );
  list[idx] = updated;
  shape.proposalsByWallet[walletName] = list;
  updateScorecardForStatusChange(shape, proposal, updated);
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    kind: eventKind,
    message:
      status === "approved"
        ? `${proposal.market} ${proposal.side} trade signal approved.`
        : `${proposal.market} ${proposal.side} trade signal rejected.`,
    createdAt: Date.now(),
    version: 1,
  });
  writeAll(shape);
  return updated;
}

function updateScorecardForStatusChange(
  shape: StoredShape,
  before: AgentTradeProposal,
  after: AgentTradeProposal,
): void {
  shape.scorecardsByWallet[after.walletName] ??= {};
  const scorecard =
    shape.scorecardsByWallet[after.walletName][after.agentId] ??
    blankScorecardForProposal(after);
  if (before.status !== "approved" && after.status === "approved") {
    scorecard.approved += 1;
    if (before.status === "needs_approval") {
      scorecard.humanOverrideCount += 1;
    }
  }
  if (before.status !== "rejected" && after.status === "rejected") {
    scorecard.rejected += 1;
  }
  if (before.status !== "blocked" && after.status === "blocked") {
    scorecard.blocked += 1;
  }
  if (before.status !== "executed" && after.status === "executed") {
    scorecard.executed += 1;
  }
  scorecard.updatedAt = Date.now();
  shape.scorecardsByWallet[after.walletName][after.agentId] = scorecard;
}

function updateScorecardForClosedExecution(
  shape: StoredShape,
  execution: AgentExecutionRecord,
): void {
  shape.scorecardsByWallet[execution.walletName] ??= {};
  const scorecard =
    shape.scorecardsByWallet[execution.walletName][execution.agentId] ??
    blankScorecardForExecution(execution);
  const pnl = Number(execution.realizedPnlUsd || 0);
  const currentPnl = Number(scorecard.realizedPnlUsd || 0);
  const nextPnl = roundMoney(currentPnl + (Number.isFinite(pnl) ? pnl : 0));
  scorecard.realizedPnlUsd = String(nextPnl);
  if (nextPnl < 0) {
    const notional = Number(execution.notionalUsd || 0);
    if (Number.isFinite(notional) && notional > 0) {
      scorecard.maxDrawdownPct = Math.max(
        scorecard.maxDrawdownPct,
        roundMoney((Math.abs(nextPnl) / notional) * 100),
      );
    }
  }
  scorecard.updatedAt = Date.now();
  shape.scorecardsByWallet[execution.walletName][execution.agentId] = scorecard;
}

function blankScorecardForExecution(execution: AgentExecutionRecord): AgentScorecard {
  return {
    walletName: execution.walletName,
    agentId: execution.agentId,
    proposals: 0,
    approved: 0,
    rejected: 0,
    blocked: 0,
    executed: 0,
    ruleViolations: 0,
    realizedPnlUsd: "0",
    maxDrawdownPct: 0,
    humanOverrideCount: 0,
    updatedAt: Date.now(),
    version: 1,
  };
}

function agentStatusEventLabel(status: AgentProfile["status"]): string {
  switch (status) {
    case "active":
      return "resumed";
    case "paused":
      return "paused";
    case "revoked":
      return "revoked";
  }
}

function sessionStatusEventLabel(status: AgentSessionGrant["status"]): string {
  switch (status) {
    case "active":
      return "resumed";
    case "paused":
      return "paused";
    case "expired":
      return "expired";
    case "revoked":
      return "revoked";
  }
}

function riskSnapshotFromShape(
  shape: StoredShape,
  walletName: string,
  agentId: string,
): AgentRiskSnapshot {
  const executions = shape.executionsByWallet[walletName] ?? [];
  const agentExecutions = executions.filter((execution) => execution.agentId === agentId);
  const openPositions = agentExecutions.filter((execution) => execution.status === "open").length;
  const lastTradeAt = agentExecutions.reduce<number | null>(
    (latest, execution) => (latest == null || execution.openedAt > latest ? execution.openedAt : latest),
    null,
  );
  return {
    openPositions,
    lastTradeAt,
    dailyRealizedPnlUsd: String(roundMoney(dailyRealizedPnl(agentExecutions, Date.now()))),
  };
}

function dailyRealizedPnl(executions: AgentExecutionRecord[], now: number): number {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  return executions
    .filter(
      (execution) =>
        execution.status === "closed" &&
        execution.closedAt != null &&
        execution.closedAt >= dayStart.getTime(),
    )
    .reduce((sum, execution) => sum + Number(execution.realizedPnlUsd || 0), 0);
}

function normalizePnl(value: string): string {
  const parsed = Number(value);
  return String(roundMoney(Number.isFinite(parsed) ? parsed : 0));
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function slugPart(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "agent";
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function appendEvent(shape: StoredShape, event: AgentAuditEvent): void {
  shape.eventsByWallet[event.walletName] ??= [];
  shape.eventsByWallet[event.walletName].push(event);
}
