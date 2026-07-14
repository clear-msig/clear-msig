import { randomUUID } from "crypto";
import { defaultAgentVaultPolicy, evaluateAgentTradeProposal } from "@/lib/agents/policy";
import { bindAgentVaultPolicyHash } from "@/lib/agents/policyHash";
import { blankAgentScorecard, scorecardForClosedExecution, scorecardForNewProposal, scorecardForStatusChange } from "@/features/agents/domain/scorecardState";
import type { AgentServerWalletState } from "@/features/agents/server/stateTypes";
import type { AgentAuditEvent, AgentExecutionRecord, AgentPolicyEvaluation, AgentProposalStatus, AgentProfile, AgentRiskSnapshot, AgentScorecard, AgentSessionGrant, AgentTradeProposal, AgentVaultPolicy } from "@/lib/agents/types";

const MAX_EVENTS_PER_WALLET = 200;

export function evaluateProposalFromState(
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

export function activeSessionFor(
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

export function riskSnapshotFromState(
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

export function statusForEvaluation(evaluation: AgentPolicyEvaluation): AgentProposalStatus {
  if (evaluation.decision === "blocked") return "blocked";
  if (evaluation.decision === "allowed") return "approved";
  return "needs_approval";
}

export function emptyState(walletName: string): AgentServerWalletState {
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

export function normalizeState(input: AgentServerWalletState): AgentServerWalletState {
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

export function normalizePolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
    version: 1,
  });
}

export function touchState(
  state: AgentServerWalletState,
  now: number,
): AgentServerWalletState {
  state.updatedAt = now;
  state.events = state.events.slice(-MAX_EVENTS_PER_WALLET);
  return state;
}


export function blankScorecard(agent: AgentProfile, now: number): AgentScorecard {
  return blankAgentScorecard(agent, now);
}

export function updateScorecardForNewProposal(
  state: AgentServerWalletState,
  proposal: AgentTradeProposal,
  now: number,
): void {
  state.scorecards[proposal.agentId] = scorecardForNewProposal(
    state.scorecards[proposal.agentId],
    proposal,
    now,
  );
}

export function updateScorecardForStatusChange(
  state: AgentServerWalletState,
  before: AgentTradeProposal,
  after: AgentTradeProposal,
  now: number,
): void {
  state.scorecards[after.agentId] = scorecardForStatusChange(
    state.scorecards[after.agentId],
    before,
    after,
    now,
    true,
  );
}

export function markProposalExecutedForExecution(
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

export function updateScorecardForClosedExecution(
  state: AgentServerWalletState,
  execution: AgentExecutionRecord,
  now: number,
): void {
  state.scorecards[execution.agentId] = scorecardForClosedExecution(
    state.scorecards[execution.agentId],
    execution,
    now,
  );
}


export function appendEvent(
  state: AgentServerWalletState,
  event: AgentAuditEvent,
): void {
  state.events.push(event);
}

export function dailyRealizedPnl(executions: AgentExecutionRecord[], now: number): number {
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

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

export function sessionStatusEventLabel(status: AgentSessionGrant["status"]): string {
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

export function agentStatusEventLabel(status: AgentProfile["status"]): string {
  switch (status) {
    case "active":
      return "resumed";
    case "paused":
      return "paused";
    case "revoked":
      return "revoked";
  }
}

export function normalizeWalletName(walletName: string): string {
  return walletName.trim();
}

export function newServerEventId(): string {
  try {
    return randomUUID();
  } catch {
    return `agent_event_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}
