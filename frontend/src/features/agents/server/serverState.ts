import { randomUUID } from "crypto";
import { canOpenLocalAgentExecution } from "@/lib/agents/executionAdapters";
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
import {
  blankAgentScorecard,
  scorecardForClosedExecution,
  scorecardForNewProposal,
  scorecardForStatusChange,
} from "@/features/agents/domain/scorecardState";
import {
  AgentServerStateConflictError,
  type AgentServerExecutionGateResult,
  type AgentServerProposalSaveResult,
  type AgentServerWalletState,
} from "@/features/agents/server/stateTypes";
import {
  assertDurableAgentStateAvailable,
  readPersistedAgentState,
  writePersistedAgentState,
} from "@/features/agents/server/statePersistence";
import {
  executionRecordMismatch,
  executionRequestMismatch,
  executionUpdateMismatch,
  findDuplicateClientSignal,
} from "@/features/agents/server/stateConsistency";
import { verifyAgentOwnerApprovalSignature } from "@/features/agents/server/ownerApprovalVerification";
import {
  activeSessionFor,
  agentStatusEventLabel,
  appendEvent,
  blankScorecard,
  emptyState,
  evaluateProposalFromState,
  formatSignedUsd,
  markProposalExecutedForExecution,
  newServerEventId,
  normalizePolicy,
  normalizeState,
  normalizeWalletName,
  riskSnapshotFromState,
  sessionStatusEventLabel,
  statusForEvaluation,
  touchState,
  updateScorecardForClosedExecution,
  updateScorecardForNewProposal,
  updateScorecardForStatusChange,
} from "@/features/agents/server/serverStateSupport";

async function readState(
  walletName: string,
): Promise<AgentServerWalletState | null> {
  return readPersistedAgentState(walletName, normalizeState);
}

async function writeState(state: AgentServerWalletState): Promise<void> {
  await writePersistedAgentState(state, normalizeState);
}
export {
  AgentServerStateConflictError,
  AgentServerStatePersistenceError,
  type AgentServerExecutionGateResult,
  type AgentServerProposalSaveResult,
  type AgentServerWalletState,
} from "@/features/agents/server/stateTypes";
export {
  agentServerStatePersistenceStatus,
  agentServerStateStorageMode,
} from "@/features/agents/server/statePersistence";
const MAX_EVENTS_PER_WALLET = 200;
const MAX_PROPOSALS_PER_WALLET = 250;
const MAX_EXECUTIONS_PER_WALLET = 250;
const MAX_APPROVALS_PER_WALLET = 250;

export async function getAgentServerWalletState(
  walletName: string,
): Promise<AgentServerWalletState> {
  const normalized = normalizeWalletName(walletName);
  assertDurableAgentStateAvailable();
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
