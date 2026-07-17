import {
  agentExecutionAdapter,
  canOpenLocalAgentExecution,
  executionModeForVenue,
} from "@/lib/agents/executionAdapters";
import { buildAgentTradeClearSign } from "@/lib/agents/clearsign";
import { defaultAgentVaultPolicy, evaluateAgentTradeProposal } from "@/lib/agents/policy";
import { bindAgentExecutionPolicyHash, bindAgentProposalPolicyHash, bindAgentSessionPolicyHash, bindAgentVaultPolicyHash } from "@/lib/agents/policyHash";
import { blankAgentScorecard, scorecardForClosedExecution, scorecardForNewProposal, scorecardForStatusChange } from "@/features/agents/domain/scorecardState";
import type { StoredShape } from "@/features/agents/local-state/repository";
import { appendEvent, newAgentEventId } from "@/features/agents/local-state/stateSupport";
import type { AgentAuditEvent, AgentExecutionRecord, AgentPolicyEvaluation, AgentProposalStatus, AgentProfile, AgentRiskSnapshot, AgentScorecard, AgentSessionGrant, AgentTradeProposal, AgentVaultPolicy } from "@/lib/agents/types";

export function newAgentExecutionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_execution_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function findDuplicateClientSignalIndex(
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


export function executionFromProposal(
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

export function findExecutionProposal(
  shape: StoredShape,
  walletName: string,
  execution: AgentExecutionRecord,
): AgentTradeProposal | undefined {
  return (shape.proposalsByWallet[walletName] ?? []).find(
    (proposal) => proposal.id === execution.proposalId,
  );
}

export function canExecuteProposal(shape: StoredShape, proposal: AgentTradeProposal): boolean {
  const evaluation = evaluateProposalForCurrentRisk(shape, proposal, Date.now());
  return evaluation?.decision === "allowed";
}

export function evaluateProposalForCurrentRisk(
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

export function currentPolicyForShape(
  shape: StoredShape,
  walletName: string,
  now = Date.now(),
): AgentVaultPolicy {
  return normalizePolicy(
    shape.policiesByWallet[walletName] ?? defaultAgentVaultPolicy(walletName, now),
  );
}

export function bindProposalClearSign(proposal: AgentTradeProposal): AgentTradeProposal {
  return {
    ...proposal,
    clearSignV2: buildAgentTradeClearSign(proposal),
  };
}

export function activeSessionFor(
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

export function statusForEvaluation(evaluation: AgentPolicyEvaluation): AgentProposalStatus {
  switch (evaluation.decision) {
    case "blocked":
      return "blocked";
    case "allowed":
      return "approved";
    case "requires_human_approval":
      return "needs_approval";
  }
}

export function appendExecutionEvents(
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


export function normalizePolicy(policy: AgentVaultPolicy): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    ...policy,
    dailyLossCapUsd: policy.dailyLossCapUsd || "100",
  });
}

export function blankScorecard(agent: AgentProfile): AgentScorecard {
  return blankAgentScorecard(agent, Date.now());
}

export function updateScorecardForNewProposal(
  shape: StoredShape,
  proposal: AgentTradeProposal,
): void {
  shape.scorecardsByWallet[proposal.walletName] ??= {};
  shape.scorecardsByWallet[proposal.walletName][proposal.agentId] =
    scorecardForNewProposal(
      shape.scorecardsByWallet[proposal.walletName][proposal.agentId],
      proposal,
      Date.now(),
    );
}

export function updateScorecardForStatusChange(
  shape: StoredShape,
  before: AgentTradeProposal,
  after: AgentTradeProposal,
): void {
  shape.scorecardsByWallet[after.walletName] ??= {};
  shape.scorecardsByWallet[after.walletName][after.agentId] =
    scorecardForStatusChange(
      shape.scorecardsByWallet[after.walletName][after.agentId],
      before,
      after,
      Date.now(),
    );
}

export function updateScorecardForClosedExecution(
  shape: StoredShape,
  execution: AgentExecutionRecord,
): void {
  shape.scorecardsByWallet[execution.walletName] ??= {};
  shape.scorecardsByWallet[execution.walletName][execution.agentId] =
    scorecardForClosedExecution(
      shape.scorecardsByWallet[execution.walletName][execution.agentId],
      execution,
      Date.now(),
    );
}



export function riskSnapshotFromShape(
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

export function normalizePnl(value: string): string {
  const parsed = Number(value);
  return String(roundMoney(Number.isFinite(parsed) ? parsed : 0));
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
