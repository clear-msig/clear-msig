"use client";

import {
  agentExecutionAdapter,
  canOpenLocalAgentExecution,
  executionModeForVenue,
} from "@/lib/agents/executionAdapters";
import { closeAgentExecutionRecord } from "@/lib/agents/executionClose";
import { evaluateAgentTradeProposal } from "@/lib/agents/policy";
import { defaultAgentVaultPolicy } from "@/lib/agents/policy";
import {
  bindAgentExecutionPolicyHash,
  bindAgentProposalPolicyHash,
  bindAgentSessionPolicyHash,
  bindAgentVaultPolicyHash,
} from "@/lib/agents/policyHash";
import { rankAgents } from "@/lib/agents/scoring";
import {
  blankAgentScorecard,
  scorecardForClosedExecution,
  scorecardForNewProposal,
  scorecardForStatusChange,
} from "@/features/agents/domain/scorecardState";
import {
  readAgentState as readAll,
  writeAgentState as writeAll,
  type StoredShape,
} from "@/features/agents/local-state/repository";
export { subscribeAgents } from "@/features/agents/local-state/repository";
import {
  appendEvent,
  newAgentEventId,
} from "@/features/agents/local-state/stateSupport";
import {
  activeSessionFor,
  appendExecutionEvents,
  bindProposalClearSign,
  canExecuteProposal,
  currentPolicyForShape,
  dailyRealizedPnl,
  evaluateProposalForCurrentRisk,
  executionFromProposal,
  findDuplicateClientSignalIndex,
  findExecutionProposal,
  formatSignedUsd,
  newAgentExecutionId,
  normalizePnl,
  normalizePolicy,
  riskSnapshotFromShape,
  roundMoney,
  statusForEvaluation,
  updateScorecardForClosedExecution,
  updateScorecardForNewProposal,
  updateScorecardForStatusChange,
} from "@/features/agents/local-state/tradeState";
import type {
  AgentAuditEvent,
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentLeaderboardEntry,
  AgentModerationStatus,
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

export {
  findAgent,
  getAgentConnectionKit,
  listAgentConnectionKits,
  listAgents,
  moderateAgentPublishingProfile,
  publishAgentProfile,
  rotateAgentSignalKey,
  saveAgent,
  unpublishAgentProfile,
  updateAgentConnectionSettings,
  updateAgentStatus,
} from "@/features/agents/local-state/profileStore";

export {
  getAgentVaultPolicy,
  saveAgentVaultPolicy,
  setAgentVaultEmergencyPause,
} from "@/features/agents/local-state/policyStore";

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
  const boundProposal = bindProposalClearSign(
    bindAgentProposalPolicyHash(proposal, normalizePolicy(policy)),
  );
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
  const updatedBase: AgentTradeProposal = bindProposalClearSign({
    ...proposalForPolicy,
    status,
    evaluationDecision: evaluation.decision,
    policyViolations: evaluation.violations,
    updatedAt: now,
  });
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
    const updated = bindProposalClearSign({
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
    });
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
    const updated = bindProposalClearSign({
      ...proposalForPolicy,
      status: "needs_approval" as AgentProposalStatus,
      evaluationDecision: evaluation.decision,
      policyViolations: evaluation.violations,
      updatedAt: now,
    });
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
    const updated = bindProposalClearSign({
      ...proposalForPolicy,
      status: "approved" as AgentProposalStatus,
      evaluationDecision: evaluation.decision,
      policyViolations: evaluation.violations,
      updatedAt: now,
    });
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
  const updated = bindProposalClearSign({
    ...proposalForPolicy,
    status: "executed" as AgentProposalStatus,
    evaluationDecision: evaluation.decision,
    policyViolations: evaluation.violations,
    updatedAt: now,
  });
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
  const boundProposal = bindProposalClearSign(
    bindAgentProposalPolicyHash(
      proposal,
      normalizePolicy(policy),
    ),
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
  const savedProposal = bindProposalClearSign(execution
    ? {
        ...boundProposal,
        status: "executed" as AgentProposalStatus,
        updatedAt: now,
      }
    : boundProposal);
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
  const updated = closeAgentExecutionRecord({
    execution,
    proposal,
    realizedPnlUsd: pnl,
    now,
  });
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
    const updated = closeAgentExecutionRecord({
      execution,
      proposal: proposals.find((item) => item.id === execution.proposalId),
      realizedPnlUsd: pnl,
      now,
    });
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

export {
  agentLeaderboard,
  listAgentEvents,
  listAgentOwnerApprovals,
  listAgentScorecards,
  listAgentSessions,
  newAgentId,
  newAgentProposalId,
  newAgentSessionId,
  renewAgentSession,
  saveAgentOwnerApproval,
  saveAgentSession,
  updateAgentSessionStatus,
} from "@/features/agents/local-state/governanceStore";


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
  const updated = bindProposalClearSign(
    bindAgentProposalPolicyHash(
      { ...proposal, status, updatedAt: Date.now() },
      policy,
    ),
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
