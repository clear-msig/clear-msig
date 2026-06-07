import { createHash, randomUUID } from "crypto";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { canOpenLocalAgentExecution } from "@/lib/agents/executionAdapters";
import { ownerApprovalSignableText } from "@/lib/agents/ownerApproval";
import { defaultAgentVaultPolicy, evaluateAgentTradeProposal } from "@/lib/agents/policy";
import {
  bindAgentExecutionPolicyHash,
  bindAgentProposalPolicyHash,
  bindAgentSessionPolicyHash,
  bindAgentVaultPolicyHash,
} from "@/lib/agents/policyHash";
import { rankAgents } from "@/lib/agents/scoring";
import type {
  AgentAuditEvent,
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
import type { AgentServerExecutionRequest } from "@/lib/agents/serverExecutionAdapters";

interface UpstashEnv {
  url: string;
  token: string;
}

export interface AgentServerWalletState {
  walletName: string;
  agents: AgentProfile[];
  policy: AgentVaultPolicy;
  proposals: AgentTradeProposal[];
  sessions: AgentSessionGrant[];
  executions: AgentExecutionRecord[];
  events: AgentAuditEvent[];
  approvals: AgentOwnerApproval[];
  scorecards: Record<string, AgentScorecard>;
  updatedAt: number;
  version: 1;
}

export interface AgentServerProposalSaveResult {
  proposal: AgentTradeProposal;
  evaluation: AgentPolicyEvaluation | null;
  duplicate: boolean;
}

export interface AgentServerExecutionGateResult {
  allowed: boolean;
  message: string;
  proposal: AgentTradeProposal | null;
  evaluation: AgentPolicyEvaluation | null;
}

export class AgentServerStateConflictError extends Error {}

const STATES = new Map<string, AgentServerWalletState>();
const MAX_EVENTS_PER_WALLET = 200;
const MAX_PROPOSALS_PER_WALLET = 250;
const MAX_EXECUTIONS_PER_WALLET = 250;
const MAX_APPROVALS_PER_WALLET = 250;

export async function getAgentServerWalletState(
  walletName: string,
): Promise<AgentServerWalletState> {
  const normalized = normalizeWalletName(walletName);
  const state = await readState(normalized);
  return state ?? emptyState(normalized);
}

export async function saveAgentServerProfile(
  agent: AgentProfile,
): Promise<AgentProfile> {
  const state = await getAgentServerWalletState(agent.walletName);
  const now = Date.now();
  const updated: AgentProfile = {
    ...agent,
    walletName: state.walletName,
    updatedAt: agent.updatedAt || now,
    version: 1,
  };
  const idx = state.agents.findIndex((item) => item.id === updated.id);
  const previous = state.agents[idx];
  if (idx >= 0) state.agents[idx] = updated;
  else state.agents.push(updated);
  state.scorecards[updated.id] ??= blankScorecard(updated, now);
  if (previous && previous.status !== updated.status) {
    appendEvent(state, {
      id: newServerEventId(),
      walletName: state.walletName,
      agentId: updated.id,
      kind: "agent_status_changed",
      message: `${updated.name} ${agentStatusEventLabel(updated.status)}.`,
      createdAt: now,
      version: 1,
    });
  }
  await writeState(touchState(state, now));
  return updated;
}

export async function saveAgentServerVaultPolicy(
  policy: AgentVaultPolicy,
): Promise<AgentVaultPolicy> {
  const state = await getAgentServerWalletState(policy.walletName);
  const now = Date.now();
  const updated = normalizePolicy({
    ...policy,
    walletName: state.walletName,
    updatedAt: policy.updatedAt || now,
    version: 1,
  });
  state.policy = updated;
  await writeState(touchState(state, now));
  return updated;
}

export async function setAgentServerEmergencyPause(
  walletName: string,
  emergencyPaused: boolean,
): Promise<AgentVaultPolicy> {
  const state = await getAgentServerWalletState(walletName);
  const now = Date.now();
  state.policy = normalizePolicy({
    ...state.policy,
    emergencyPaused,
    updatedAt: now,
  });
  appendEvent(state, {
    id: newServerEventId(),
    walletName: state.walletName,
    kind: "policy_emergency_pause_changed",
    message: emergencyPaused
      ? "Agent Trading kill switch turned on."
      : "Agent Trading kill switch turned off.",
    createdAt: now,
    version: 1,
  });
  await writeState(touchState(state, now));
  return state.policy;
}

export async function saveAgentServerOwnerApproval(
  approval: AgentOwnerApproval,
): Promise<AgentOwnerApproval> {
  const state = await getAgentServerWalletState(approval.walletName);
  const now = Date.now();
  const normalized: AgentOwnerApproval = {
    ...approval,
    walletName: state.walletName,
    details: Array.isArray(approval.details) ? approval.details.slice(0, 12) : [],
    approvalMethod: approval.signature ? "wallet_signature" : approval.approvalMethod,
    createdAt: approval.createdAt || now,
    version: 1,
  };
  if (normalized.signature && !verifyAgentOwnerApprovalSignature(normalized)) {
    throw new AgentServerStateConflictError(
      "Owner approval signature could not be verified.",
    );
  }
  const existingIndex = state.approvals.findIndex(
    (item) => item.id === normalized.id || item.approvalHash === normalized.approvalHash,
  );
  const isNew = existingIndex < 0;
  if (existingIndex >= 0) state.approvals[existingIndex] = normalized;
  else {
    state.approvals.unshift(normalized);
    state.approvals = state.approvals.slice(0, MAX_APPROVALS_PER_WALLET);
  }
  if (isNew) {
    appendEvent(state, {
      id: newServerEventId(),
      walletName: state.walletName,
      agentId: normalized.agentId,
      kind: "owner_action_approved",
      message: `${normalized.summary} approved by owner.`,
      createdAt: normalized.createdAt,
      version: 1,
    });
  }
  await writeState(touchState(state, now));
  return normalized;
}

export async function hasAgentServerWalletSignedOwnerApproval({
  walletName,
  agentId,
  action,
  targetType,
  targetId,
}: {
  walletName: string;
  agentId?: string;
  action: AgentOwnerApproval["action"];
  targetType: NonNullable<AgentOwnerApproval["targetType"]>;
  targetId: string;
}): Promise<boolean> {
  const state = await getAgentServerWalletState(walletName);
  return state.approvals.some(
    (approval) =>
      approval.action === action &&
      approval.targetType === targetType &&
      approval.targetId === targetId &&
      approval.approvalMethod === "wallet_signature" &&
      Boolean(approval.signature) &&
      Boolean(approval.approvedBy) &&
      (!agentId || approval.agentId === agentId) &&
      verifyAgentOwnerApprovalSignature(approval),
  );
}

export async function saveAgentServerSession(
  session: AgentSessionGrant,
): Promise<AgentSessionGrant> {
  const state = await getAgentServerWalletState(session.walletName);
  const updated = bindAgentSessionPolicyHash(
    {
      ...session,
      walletName: state.walletName,
      version: 1,
    },
    state.policy,
  );
  const now = Date.now();
  if (updated.status === "active") {
    state.sessions = state.sessions.map((item) =>
      item.id !== updated.id &&
      item.agentId === updated.agentId &&
      item.status === "active"
        ? { ...item, status: "revoked", updatedAt: now }
        : item,
    );
  }
  const idx = state.sessions.findIndex((item) => item.id === updated.id);
  if (idx >= 0) state.sessions[idx] = updated;
  else state.sessions.push(updated);
  await writeState(touchState(state, now));
  return updated;
}

export async function updateAgentServerSessionStatus({
  walletName,
  id,
  status,
}: {
  walletName: string;
  id: string;
  status: AgentSessionGrant["status"];
}): Promise<AgentSessionGrant | null> {
  const state = await getAgentServerWalletState(walletName);
  const idx = state.sessions.findIndex((item) => item.id === id);
  const session = state.sessions[idx];
  if (!session) return null;
  const now = Date.now();
  const updated: AgentSessionGrant = { ...session, status, updatedAt: now };
  state.sessions[idx] = updated;
  appendEvent(state, {
    id: newServerEventId(),
    walletName: state.walletName,
    agentId: session.agentId,
    kind: "session_status_changed",
    message: `Trading session ${sessionStatusEventLabel(status)}.`,
    createdAt: now,
    version: 1,
  });
  await writeState(touchState(state, now));
  return updated;
}

export async function saveAgentServerProposal(
  proposal: AgentTradeProposal,
): Promise<AgentServerProposalSaveResult> {
  const state = await getAgentServerWalletState(proposal.walletName);
  const existingByRetryId = findDuplicateClientSignal(state.proposals, proposal);
  if (existingByRetryId) {
    return { proposal: existingByRetryId, evaluation: null, duplicate: true };
  }

  const now = Date.now();
  const evaluation = evaluateProposalFromState(state, proposal, now);
  const nextStatus = evaluation
    ? statusForEvaluation(evaluation)
    : ("blocked" as AgentProposalStatus);
  const updated: AgentTradeProposal = {
    ...proposal,
    walletName: state.walletName,
    status: nextStatus,
    evaluationDecision: evaluation?.decision ?? "blocked",
    policyViolations:
      evaluation?.violations ?? [
        {
          code: "agent_not_active",
          message: "Trading agent was not found in backend state.",
          severity: "block",
        },
      ],
    updatedAt: now,
    version: 1,
  };
  const boundUpdated = bindAgentProposalPolicyHash(updated, state.policy);

  const idx = state.proposals.findIndex((item) => item.id === boundUpdated.id);
  const previous = state.proposals[idx];
  if (idx >= 0) {
    state.proposals[idx] = boundUpdated;
    if (previous) updateScorecardForStatusChange(state, previous, boundUpdated, now);
  } else {
    state.proposals.unshift(boundUpdated);
    state.proposals = state.proposals.slice(0, MAX_PROPOSALS_PER_WALLET);
    updateScorecardForNewProposal(state, boundUpdated, now);
    appendEvent(state, {
      id: newServerEventId(),
      walletName: state.walletName,
      agentId: boundUpdated.agentId,
      proposalId: boundUpdated.id,
      kind: "proposal_created",
      message: `${boundUpdated.market} ${boundUpdated.side} trade signal saved after backend policy check.`,
      createdAt: now,
      version: 1,
    });
  }

  await writeState(touchState(state, now));
  return { proposal: boundUpdated, evaluation, duplicate: false };
}

export async function evaluateAgentServerProposal(
  proposal: AgentTradeProposal,
): Promise<AgentPolicyEvaluation | null> {
  const state = await getAgentServerWalletState(proposal.walletName);
  return evaluateProposalFromState(state, proposal, Date.now());
}

export async function approveAgentServerProposal(
  walletName: string,
  id: string,
): Promise<AgentServerProposalSaveResult | null> {
  const state = await getAgentServerWalletState(walletName);
  const idx = state.proposals.findIndex((item) => item.id === id);
  const proposal = state.proposals[idx];
  if (!proposal || proposal.status === "executed" || proposal.status === "rejected") {
    return proposal ? { proposal, evaluation: null, duplicate: false } : null;
  }

  const now = Date.now();
  const evaluation = evaluateProposalFromState(state, proposal, now);
  const nextStatus =
    evaluation?.decision === "blocked" ? "blocked" : ("approved" as AgentProposalStatus);
  const updated: AgentTradeProposal = {
    ...proposal,
    status: nextStatus,
    evaluationDecision: evaluation?.decision ?? "blocked",
    policyViolations: evaluation?.violations ?? proposal.policyViolations,
    updatedAt: now,
  };
  const boundUpdated = bindAgentProposalPolicyHash(updated, state.policy);
  state.proposals[idx] = boundUpdated;
  updateScorecardForStatusChange(state, proposal, boundUpdated, now);
  appendEvent(state, {
    id: newServerEventId(),
    walletName: state.walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    kind: nextStatus === "approved" ? "proposal_approved" : "proposal_rechecked",
    message:
      nextStatus === "approved"
        ? `${proposal.market} ${proposal.side} trade signal approved after backend policy check.`
        : `${proposal.market} ${proposal.side} trade signal failed backend policy check.`,
    createdAt: now,
    version: 1,
  });
  await writeState(touchState(state, now));
  return { proposal: boundUpdated, evaluation, duplicate: false };
}

export async function rejectAgentServerProposal(
  walletName: string,
  id: string,
): Promise<AgentTradeProposal | null> {
  const state = await getAgentServerWalletState(walletName);
  const idx = state.proposals.findIndex((item) => item.id === id);
  const proposal = state.proposals[idx];
  if (!proposal || proposal.status === "executed") return proposal ?? null;
  const now = Date.now();
  const updated: AgentTradeProposal = { ...proposal, status: "rejected", updatedAt: now };
  state.proposals[idx] = updated;
  updateScorecardForStatusChange(state, proposal, updated, now);
  appendEvent(state, {
    id: newServerEventId(),
    walletName: state.walletName,
    agentId: proposal.agentId,
    proposalId: proposal.id,
    kind: "proposal_rejected",
    message: `${proposal.market} ${proposal.side} trade signal rejected.`,
    createdAt: now,
    version: 1,
  });
  await writeState(touchState(state, now));
  return updated;
}

export async function saveAgentServerExecution(
  execution: AgentExecutionRecord,
): Promise<AgentExecutionRecord> {
  const state = await getAgentServerWalletState(execution.walletName);
  const now = Date.now();
  const proposal = state.proposals.find((item) => item.id === execution.proposalId);
  const existingIndex = state.executions.findIndex((item) => item.id === execution.id);
  const previous = state.executions[existingIndex];
  if (previous) {
    validateAgentServerExecutionUpdate(previous, execution);
    if (previous.status === "closed" || execution.status === "open") {
      return previous;
    }
  } else {
    validateNewAgentServerExecution(state, execution, proposal, now);
  }
  const updated = bindAgentExecutionPolicyHash(
    {
      ...execution,
      walletName: state.walletName,
      version: 1,
    },
    proposal,
  );
  if (existingIndex >= 0) state.executions[existingIndex] = updated;
  else {
    state.executions.unshift(updated);
    state.executions = state.executions.slice(0, MAX_EXECUTIONS_PER_WALLET);
  }

  markProposalExecutedForExecution(state, updated, now);
  if (!previous) {
    appendEvent(state, {
      id: newServerEventId(),
      walletName: state.walletName,
      agentId: updated.agentId,
      proposalId: updated.proposalId,
      executionId: updated.id,
      kind: "execution_opened",
      message: `Paper trade opened for $${updated.notionalUsd} at ${updated.leverage}x.`,
      createdAt: updated.openedAt || now,
      version: 1,
    });
  }
  if (previous?.status !== "closed" && updated.status === "closed") {
    updateScorecardForClosedExecution(state, updated, now);
    appendEvent(state, {
      id: newServerEventId(),
      walletName: state.walletName,
      agentId: updated.agentId,
      proposalId: updated.proposalId,
      executionId: updated.id,
      kind: "execution_closed",
      message: `${updated.market} ${updated.side} paper trade closed at ${formatSignedUsd(updated.realizedPnlUsd)} PnL.`,
      createdAt: updated.closedAt ?? now,
      version: 1,
    });
  }

  await writeState(touchState(state, now));
  return updated;
}

function validateNewAgentServerExecution(
  state: AgentServerWalletState,
  execution: AgentExecutionRecord,
  proposal: AgentTradeProposal | undefined,
  now: number,
): void {
  if (!proposal) {
    throw new AgentServerStateConflictError(
      "Paper execution must reference a proposal in backend agent state.",
    );
  }
  if (state.executions.some((item) => item.proposalId === proposal.id)) {
    throw new AgentServerStateConflictError(
      "This proposal already has a backend execution record.",
    );
  }
  if (proposal.status !== "approved") {
    throw new AgentServerStateConflictError(
      "Paper execution requires an approved backend proposal.",
    );
  }
  if (!canOpenLocalAgentExecution(proposal.venue)) {
    throw new AgentServerStateConflictError(
      "Only local paper venues can persist browser paper executions.",
    );
  }
  if (
    execution.status !== "open" ||
    execution.executionMode !== "paper" ||
    execution.adapterStatus !== "ready"
  ) {
    throw new AgentServerStateConflictError(
      "A new backend paper execution must be an open paper trade.",
    );
  }
  const mismatch = executionRecordMismatch(proposal, execution);
  if (mismatch) throw new AgentServerStateConflictError(mismatch);
  const hashMismatch = policyHashMismatchMessage(state.policy, proposal);
  if (hashMismatch) throw new AgentServerStateConflictError(hashMismatch);
  if (!execution.policyHash || execution.policyHash !== proposal.policyHash) {
    throw new AgentServerStateConflictError(
      "Paper execution policy hash does not match the approved proposal.",
    );
  }
  const evaluation = evaluateProposalFromState(state, proposal, now);
  if (!evaluation || evaluation.decision === "blocked") {
    throw new AgentServerStateConflictError(
      evaluation?.violations[0]?.message ??
        "Paper execution failed the current backend policy gate.",
    );
  }
}

function validateAgentServerExecutionUpdate(
  previous: AgentExecutionRecord,
  incoming: AgentExecutionRecord,
): void {
  const mismatch = executionUpdateMismatch(previous, incoming);
  if (mismatch) throw new AgentServerStateConflictError(mismatch);
  if (previous.status === "closed" && incoming.status !== "closed") {
    throw new AgentServerStateConflictError("Closed paper executions cannot be reopened.");
  }
  if (previous.status === "open" && incoming.status === "closed" && !incoming.closedAt) {
    throw new AgentServerStateConflictError(
      "Closing a paper execution requires a close timestamp.",
    );
  }
}

export async function validateAgentServerExecutionHandoff(
  request: AgentServerExecutionRequest,
): Promise<AgentServerExecutionGateResult> {
  const state = await getAgentServerWalletState(request.walletName);
  const proposal =
    state.proposals.find(
      (item) => item.id === request.proposalId && item.agentId === request.agentId,
    ) ?? null;
  if (!proposal) {
    return {
      allowed: false,
      message: "Trade signal is not present in backend agent state.",
      proposal: null,
      evaluation: null,
    };
  }

  const mismatch = executionRequestMismatch(proposal, request);
  if (mismatch) {
    return {
      allowed: false,
      message: mismatch,
      proposal,
      evaluation: null,
    };
  }

  if (proposal.status !== "approved") {
    return {
      allowed: false,
      message: "Trade signal must be approved before server venue handoff.",
      proposal,
      evaluation: null,
    };
  }

  const hashMismatch = policyHashMismatchMessage(state.policy, proposal);
  if (hashMismatch) {
    return {
      allowed: false,
      message: hashMismatch,
      proposal,
      evaluation: null,
    };
  }

  const evaluation = evaluateProposalFromState(state, proposal, Date.now());
  if (!evaluation) {
    return {
      allowed: false,
      message: "Trading agent is not present in backend agent state.",
      proposal,
      evaluation: null,
    };
  }
  if (evaluation.decision === "blocked") {
    return {
      allowed: false,
      message:
        evaluation.violations[0]?.message ??
        "Trade signal is blocked by current backend risk limits.",
      proposal,
      evaluation,
    };
  }

  return {
    allowed: true,
    message: "Trade signal passed backend policy gate.",
    proposal,
    evaluation,
  };
}

function policyHashMismatchMessage(
  policy: AgentVaultPolicy,
  proposal: AgentTradeProposal,
): string | null {
  if (!policy.policyHash) {
    return "Current backend policy is missing a policy hash; re-save the vault policy before venue handoff.";
  }
  if (!proposal.policyHash) {
    return "Trade signal is missing a policy hash; recheck or re-approve it before venue handoff.";
  }
  if (proposal.policyHash !== policy.policyHash) {
    return "Trade signal was approved under an older policy hash; re-approve it before venue handoff.";
  }
  return null;
}

export async function agentServerLeaderboard(
  walletName: string,
): Promise<AgentLeaderboardEntry[]> {
  const state = await getAgentServerWalletState(walletName);
  return rankAgents(Object.values(state.scorecards));
}

export function agentServerStateStorageMode(): "redis" | "memory" {
  return readUpstashEnv() ? "redis" : "memory";
}

function evaluateProposalFromState(
  state: AgentServerWalletState,
  proposal: AgentTradeProposal,
  now: number,
): AgentPolicyEvaluation | null {
  const agent = state.agents.find((item) => item.id === proposal.agentId);
  if (!agent) return null;
  return evaluateAgentTradeProposal({
    agent,
    proposal,
    policy: state.policy,
    session: activeSessionFor(state, proposal.agentId, now),
    risk: riskSnapshotFromState(state, proposal.agentId, now),
    now,
  });
}

function activeSessionFor(
  state: AgentServerWalletState,
  agentId: string,
  now: number,
): AgentSessionGrant | null {
  return (
    state.sessions.find(
      (item) =>
        item.agentId === agentId &&
        item.status === "active" &&
        item.expiresAt > now,
    ) ?? null
  );
}

function riskSnapshotFromState(
  state: AgentServerWalletState,
  agentId: string,
  now: number,
): AgentRiskSnapshot {
  const executions = state.executions.filter((item) => item.agentId === agentId);
  const lastTradeAt = executions.reduce<number | null>(
    (latest, item) =>
      latest == null || item.openedAt > latest
        ? item.openedAt
        : latest,
    null,
  );
  return {
    openPositions: executions.filter((item) => item.status === "open").length,
    lastTradeAt,
    dailyRealizedPnlUsd: String(roundMoney(dailyRealizedPnl(executions, now))),
    realizedPnlUsd: String(
      roundMoney(
        executions
          .filter((item) => item.status === "closed")
          .reduce((sum, item) => sum + Number(item.realizedPnlUsd || 0), 0),
      ),
    ),
    maxDrawdownPct: 0,
  };
}

function statusForEvaluation(evaluation: AgentPolicyEvaluation): AgentProposalStatus {
  if (evaluation.decision === "blocked") return "blocked";
  if (evaluation.decision === "allowed") return "approved";
  return "needs_approval";
}

function emptyState(walletName: string): AgentServerWalletState {
  const now = Date.now();
  return {
    walletName,
    agents: [],
    policy: normalizePolicy(defaultAgentVaultPolicy(walletName, now)),
    proposals: [],
    sessions: [],
    executions: [],
    events: [],
    approvals: [],
    scorecards: {},
    updatedAt: now,
    version: 1,
  };
}

function normalizeState(input: AgentServerWalletState): AgentServerWalletState {
  return {
    ...emptyState(input.walletName),
    ...input,
    policy: normalizePolicy(input.policy),
    agents: input.agents ?? [],
    proposals: input.proposals ?? [],
    sessions: input.sessions ?? [],
    executions: input.executions ?? [],
    events: input.events ?? [],
    approvals: input.approvals ?? [],
    scorecards: input.scorecards ?? {},
    version: 1,
  };
}

function normalizePolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
    version: 1,
  });
}

function touchState(
  state: AgentServerWalletState,
  now: number,
): AgentServerWalletState {
  state.updatedAt = now;
  state.events = state.events.slice(-MAX_EVENTS_PER_WALLET);
  return state;
}

async function readState(walletName: string): Promise<AgentServerWalletState | null> {
  const redis = readUpstashEnv();
  if (redis) {
    const state = await redisGet<AgentServerWalletState>(stateRedisKey(walletName), redis);
    return state ? normalizeState(state) : null;
  }
  const state = STATES.get(walletName);
  return state ? normalizeState(state) : null;
}

async function writeState(state: AgentServerWalletState): Promise<void> {
  const redis = readUpstashEnv();
  if (redis) {
    await redisSet(stateRedisKey(state.walletName), state, redis);
    return;
  }
  STATES.set(state.walletName, normalizeState(state));
}

function findDuplicateClientSignal(
  list: AgentTradeProposal[],
  proposal: AgentTradeProposal,
): AgentTradeProposal | null {
  const clientSignalId = proposal.clientSignalId?.trim();
  if (!clientSignalId) return null;
  return (
    list.find(
      (item) =>
        item.id !== proposal.id &&
        item.agentId === proposal.agentId &&
        item.clientSignalId === clientSignalId,
    ) ?? null
  );
}

function executionRequestMismatch(
  proposal: AgentTradeProposal,
  request: AgentServerExecutionRequest,
): string | null {
  if (proposal.walletName !== request.walletName) {
    return "Trade request wallet does not match the approved signal.";
  }
  if (proposal.venue !== request.venue) {
    return "Trade request venue does not match the approved signal.";
  }
  if (proposal.market.trim().toUpperCase() !== request.market.trim().toUpperCase()) {
    return "Trade request market does not match the approved signal.";
  }
  if (proposal.side !== request.side) {
    return "Trade request side does not match the approved signal.";
  }
  if (proposal.orderType !== request.orderType) {
    return "Trade request order type does not match the approved signal.";
  }
  if (proposal.notionalUsd !== request.notionalUsd) {
    return "Trade request notional does not match the approved signal.";
  }
  if (proposal.leverage !== request.leverage) {
    return "Trade request leverage does not match the approved signal.";
  }
  return null;
}

function executionRecordMismatch(
  proposal: AgentTradeProposal,
  execution: AgentExecutionRecord,
): string | null {
  if (proposal.walletName !== execution.walletName) {
    return "Paper execution wallet does not match the approved proposal.";
  }
  if (proposal.agentId !== execution.agentId) {
    return "Paper execution agent does not match the approved proposal.";
  }
  if (proposal.venue !== execution.venue) {
    return "Paper execution venue does not match the approved proposal.";
  }
  if (proposal.market.trim().toUpperCase() !== execution.market.trim().toUpperCase()) {
    return "Paper execution market does not match the approved proposal.";
  }
  if (proposal.side !== execution.side || proposal.orderType !== execution.orderType) {
    return "Paper execution order does not match the approved proposal.";
  }
  if (
    proposal.notionalUsd !== execution.notionalUsd ||
    proposal.leverage !== execution.leverage
  ) {
    return "Paper execution risk values do not match the approved proposal.";
  }
  if ((proposal.entryPrice ?? null) !== (execution.entryPrice ?? null)) {
    return "Paper execution entry price does not match the approved proposal.";
  }
  return null;
}

function executionUpdateMismatch(
  previous: AgentExecutionRecord,
  incoming: AgentExecutionRecord,
): string | null {
  if (
    previous.walletName !== incoming.walletName ||
    previous.proposalId !== incoming.proposalId ||
    previous.agentId !== incoming.agentId ||
    previous.venue !== incoming.venue ||
    previous.market !== incoming.market ||
    previous.side !== incoming.side ||
    previous.orderType !== incoming.orderType ||
    previous.notionalUsd !== incoming.notionalUsd ||
    previous.leverage !== incoming.leverage ||
    (previous.entryPrice ?? null) !== (incoming.entryPrice ?? null) ||
    previous.executionMode !== incoming.executionMode ||
    previous.adapterStatus !== incoming.adapterStatus ||
    previous.externalOrderId !== incoming.externalOrderId ||
    previous.policyHash !== incoming.policyHash ||
    previous.openedAt !== incoming.openedAt
  ) {
    return "Paper execution update changed immutable execution fields.";
  }
  return null;
}

function blankScorecard(agent: AgentProfile, now: number): AgentScorecard {
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
    updatedAt: now,
    version: 1,
  };
}

function blankScorecardForProposal(
  proposal: AgentTradeProposal,
  now: number,
): AgentScorecard {
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
    updatedAt: now,
    version: 1,
  };
}

function updateScorecardForNewProposal(
  state: AgentServerWalletState,
  proposal: AgentTradeProposal,
  now: number,
): void {
  const scorecard =
    state.scorecards[proposal.agentId] ?? blankScorecardForProposal(proposal, now);
  scorecard.proposals += 1;
  scorecard.ruleViolations += proposal.policyViolations?.length ?? 0;
  applyStatusIncrement(scorecard, proposal.status);
  scorecard.updatedAt = now;
  state.scorecards[proposal.agentId] = scorecard;
}

function updateScorecardForStatusChange(
  state: AgentServerWalletState,
  before: AgentTradeProposal,
  after: AgentTradeProposal,
  now: number,
): void {
  const scorecard =
    state.scorecards[after.agentId] ?? blankScorecardForProposal(after, now);
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
  scorecard.ruleViolations += after.policyViolations?.length ?? 0;
  scorecard.updatedAt = now;
  state.scorecards[after.agentId] = scorecard;
}

function markProposalExecutedForExecution(
  state: AgentServerWalletState,
  execution: AgentExecutionRecord,
  now: number,
): void {
  const idx = state.proposals.findIndex((item) => item.id === execution.proposalId);
  const proposal = state.proposals[idx];
  if (!proposal || proposal.status === "executed") return;
  const updated: AgentTradeProposal = {
    ...proposal,
    status: "executed",
    updatedAt: execution.openedAt || now,
  };
  state.proposals[idx] = updated;
  updateScorecardForStatusChange(state, proposal, updated, now);
  appendEvent(state, {
    id: newServerEventId(),
    walletName: state.walletName,
    agentId: execution.agentId,
    proposalId: execution.proposalId,
    executionId: execution.id,
    kind: "proposal_executed",
    message: `${execution.market} ${execution.side} paper trade opened.`,
    createdAt: execution.openedAt || now,
    version: 1,
  });
}

function updateScorecardForClosedExecution(
  state: AgentServerWalletState,
  execution: AgentExecutionRecord,
  now: number,
): void {
  const scorecard =
    state.scorecards[execution.agentId] ?? blankScorecardForExecution(execution, now);
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
  scorecard.updatedAt = now;
  state.scorecards[execution.agentId] = scorecard;
}

function blankScorecardForExecution(
  execution: AgentExecutionRecord,
  now: number,
): AgentScorecard {
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
    updatedAt: now,
    version: 1,
  };
}

function applyStatusIncrement(
  scorecard: AgentScorecard,
  status: AgentProposalStatus,
): void {
  if (status === "approved") scorecard.approved += 1;
  if (status === "rejected") scorecard.rejected += 1;
  if (status === "blocked") scorecard.blocked += 1;
  if (status === "executed") {
    scorecard.executed += 1;
    scorecard.approved += 1;
  }
}

function verifyAgentOwnerApprovalSignature(approval: AgentOwnerApproval): boolean {
  if (!approval.signature || !approval.approvedBy) return false;
  const signature = hexToBytes(approval.signature);
  if (!signature || signature.length !== 64) return false;
  let publicKey: PublicKey;
  try {
    publicKey = new PublicKey(approval.approvedBy);
  } catch {
    return false;
  }
  const message = ownerApprovalSignableText(
    {
      walletName: approval.walletName,
      agentId: approval.agentId,
      action: approval.action,
      summary: approval.summary,
      details: approval.details,
      targetType: approval.targetType,
      targetId: approval.targetId,
    },
    approval.createdAt,
  );
  return nacl.sign.detached.verify(
    new TextEncoder().encode(message),
    signature,
    publicKey.toBytes(),
  );
}

function hexToBytes(value: string): Uint8Array | null {
  const normalized = value.trim().toLowerCase();
  if (!/^[0-9a-f]*$/.test(normalized) || normalized.length % 2 !== 0) {
    return null;
  }
  const bytes = new Uint8Array(normalized.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(normalized.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function appendEvent(
  state: AgentServerWalletState,
  event: AgentAuditEvent,
): void {
  state.events.push(event);
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

function normalizeWalletName(walletName: string): string {
  return walletName.trim();
}

function stateRedisKey(walletName: string): string {
  return `agent:state:${hashStorageKey(walletName)}`;
}

function hashStorageKey(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 40);
}

function newServerEventId(): string {
  try {
    return randomUUID();
  } catch {
    return `agent_event_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function readUpstashEnv(): UpstashEnv | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url, token };
}

async function redisGet<T>(key: string, env: UpstashEnv): Promise<T | null> {
  const result = await redisCommand(["GET", key], env);
  if (typeof result !== "string") return null;
  try {
    return JSON.parse(result) as T;
  } catch {
    return null;
  }
}

async function redisSet<T>(key: string, value: T, env: UpstashEnv): Promise<void> {
  await redisCommand(["SET", key, JSON.stringify(value)], env);
}

async function redisCommand(command: string[], env: UpstashEnv): Promise<unknown> {
  const response = await fetch(`${env.url}/pipeline`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.token}`,
    },
    body: JSON.stringify([command]),
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) {
    throw new Error(`Agent state store returned ${response.status}`);
  }
  const payload = (await response.json()) as Array<{ result?: unknown; error?: string }>;
  if (payload[0]?.error) {
    throw new Error(payload[0].error);
  }
  return payload[0]?.result ?? null;
}
