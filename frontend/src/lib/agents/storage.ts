"use client";

import { evaluateAgentTradeProposal } from "@/lib/agents/policy";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import { rankAgents } from "@/lib/agents/scoring";
import type {
  AgentAuditEvent,
  AgentExecutionRecord,
  AgentLeaderboardEntry,
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

export function getAgentVaultPolicy(walletName: string): AgentVaultPolicy {
  return normalizePolicy(
    readAll().policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName),
  );
}

export function saveAgentVaultPolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  const shape = readAll();
  shape.policiesByWallet[policy.walletName] = policy;
  writeAll(shape);
  return policy;
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
  const list = shape.proposalsByWallet[proposal.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === proposal.id);
  if (idx >= 0) list[idx] = proposal;
  else {
    list.push(proposal);
    updateScorecardForNewProposal(shape, proposal);
    appendEvent(shape, {
      id: newAgentEventId(),
      walletName: proposal.walletName,
      agentId: proposal.agentId,
      proposalId: proposal.id,
      kind: "proposal_created",
      message: `${proposal.market} ${proposal.side} trade signal saved.`,
      createdAt: Date.now(),
      version: 1,
    });
  }
  shape.proposalsByWallet[proposal.walletName] = list;
  writeAll(shape);
  return proposal;
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
  const policy =
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName, now);
  const evaluation = evaluateAgentTradeProposal({
    agent,
    proposal,
    policy,
    session,
    risk: riskSnapshotFromShape(shape, walletName, proposal.agentId),
    now,
  });
  const status = statusForEvaluation(evaluation);
  const execution =
    status === "approved" ? executionFromProposal(proposal, now) : null;
  const updated: AgentTradeProposal = {
    ...proposal,
    status: execution ? "executed" : status,
    evaluationDecision: evaluation.decision,
    policyViolations: evaluation.violations,
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
  const shape = readAll();
  const list = shape.proposalsByWallet[walletName] ?? [];
  const idx = list.findIndex((proposal) => proposal.id === id);
  if (idx < 0) return null;
  const proposal = list[idx];
  if (!proposal || proposal.status !== "approved") return null;
  if (!canExecuteProposal(shape, proposal)) return null;
  const now = Date.now();
  const execution = executionFromProposal(proposal, now);
  const updated = {
    ...proposal,
    status: "executed" as AgentProposalStatus,
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
  return execution;
}

export function saveAgentProposalAndExecuteIfAllowed(
  proposal: AgentTradeProposal,
): { proposal: AgentTradeProposal; execution: AgentExecutionRecord | null } {
  const shape = readAll();
  const list = shape.proposalsByWallet[proposal.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === proposal.id);
  const shouldExecute = proposal.status === "approved" && canExecuteProposal(shape, proposal);
  const now = Date.now();
  const savedProposal = shouldExecute
    ? {
        ...proposal,
        status: "executed" as AgentProposalStatus,
        updatedAt: now,
      }
    : proposal;
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
  shape.proposalsByWallet[proposal.walletName] = list;
  const execution = shouldExecute ? executionFromProposal(savedProposal, now) : null;
  if (execution) {
    shape.executionsByWallet[proposal.walletName] ??= [];
    shape.executionsByWallet[proposal.walletName].push(execution);
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
  const updated: AgentExecutionRecord = {
    ...execution,
    status: "closed",
    closedAt: now,
    realizedPnlUsd: pnl,
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

export function listAgentSessions(walletName: string): AgentSessionGrant[] {
  return [...(readAll().sessionsByWallet[walletName] ?? [])].sort(
    (a, b) => b.createdAt - a.createdAt,
  );
}

export function saveAgentSession(session: AgentSessionGrant): AgentSessionGrant {
  const shape = readAll();
  const list = shape.sessionsByWallet[session.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === session.id);
  if (idx >= 0) list[idx] = session;
  else list.push(session);
  shape.sessionsByWallet[session.walletName] = list;
  writeAll(shape);
  return session;
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
  shape.sessionsByWallet[walletName] ??= [];
  shape.sessionsByWallet[walletName].push(renewed);
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: renewed.agentId,
    kind: "session_renewed",
    message: "Trading session renewed.",
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return renewed;
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

function executionFromProposal(
  proposal: AgentTradeProposal,
  now: number,
): AgentExecutionRecord {
  return {
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
    status: "open",
    openedAt: now,
    closedAt: null,
    realizedPnlUsd: "0",
    version: 1,
  };
}

function canExecuteProposal(shape: StoredShape, proposal: AgentTradeProposal): boolean {
  const agent = (shape.agentsByWallet[proposal.walletName] ?? []).find(
    (item) => item.id === proposal.agentId,
  );
  if (!agent) return false;
  const now = Date.now();
  const session = activeSessionFor(shape, proposal.walletName, proposal.agentId, now);
  const policy =
    shape.policiesByWallet[proposal.walletName] ??
    defaultAgentVaultPolicy(proposal.walletName, now);
  const evaluation = evaluateAgentTradeProposal({
    agent,
    proposal,
    policy,
    session,
    risk: riskSnapshotFromShape(shape, proposal.walletName, proposal.agentId),
    now,
  });
  return evaluation.decision === "allowed";
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
  return {
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
  };
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
  const updated = { ...proposal, status, updatedAt: Date.now() };
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
