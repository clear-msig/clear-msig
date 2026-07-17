import type { AgentServerExecutionRequest } from "@/lib/agents/serverExecutionAdapters";
import type {
  AgentExecutionRecord,
  AgentTradeProposal,
} from "@/lib/agents/types";

export function findDuplicateClientSignal(
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

export function executionRequestMismatch(
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

export function executionRecordMismatch(
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
  if (
    proposal.market.trim().toUpperCase() !==
    execution.market.trim().toUpperCase()
  ) {
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

export function executionUpdateMismatch(
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
