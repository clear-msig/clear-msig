import { randomUUID } from "crypto";
import { canOpenLocalAgentExecution } from "@/lib/agents/executionAdapters";
import {
  serverAgentExecutionReadiness,
  serverExecutionRequestFromProposal,
} from "@/lib/agents/serverExecutionAdapters";
import {
  readHyperliquidTestnetExecutorConfig,
} from "@/lib/agents/hyperliquidTestnetConfig";
import {
  submitHyperliquidTestnetOrder,
} from "@/lib/agents/serverHyperliquidTestnet";
import {
  listAgentServerExecutionRequests,
  recordAgentServerExecutionRequest,
  type AgentServerExecutionRecord,
} from "@/lib/agents/serverExecutionRequests";
import {
  getAgentServerWalletState,
  saveAgentServerExecution,
  validateAgentServerExecutionHandoff,
} from "@/lib/agents/serverState";
import type {
  AgentExecutionRecord,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface AgentAutomaticExecutionResult {
  placed: boolean;
  message: string;
  execution?: AgentExecutionRecord;
  outsideRequest?: AgentServerExecutionRecord;
}

export async function executeAllowedAgentProposal(
  proposal: AgentTradeProposal,
): Promise<AgentAutomaticExecutionResult> {
  if (proposal.status !== "approved") {
    return { placed: false, message: "The trade idea is not approved." };
  }

  if (canOpenLocalAgentExecution(proposal.venue)) {
    const state = await getAgentServerWalletState(proposal.walletName);
    const existing = state.executions.find(
      (execution) => execution.proposalId === proposal.id,
    );
    if (existing) {
      return {
        placed: true,
        message: "The built-in practice trade was already placed.",
        execution: existing,
      };
    }
    const execution = await saveAgentServerExecution(
      executionFromProposal(proposal),
    );
    return {
      placed: true,
      message: "The built-in practice trade was placed.",
      execution,
    };
  }

  const request = serverExecutionRequestFromProposal(proposal, proposal.updatedAt);
  const readiness = serverAgentExecutionReadiness(proposal.venue);
  const gate = await validateAgentServerExecutionHandoff(request);
  if (!gate.allowed) {
    return { placed: false, message: gate.message };
  }
  if (!readiness.canSubmit || proposal.venue !== "hyperliquid_testnet") {
    return { placed: false, message: readiness.message };
  }

  const existing = (
    await listAgentServerExecutionRequests(proposal.walletName, proposal.agentId)
  ).find(
    (item) =>
      item.request.proposalId === proposal.id &&
      item.request.venue === proposal.venue &&
      item.status === "submitted",
  );
  if (existing) {
    return {
      placed: true,
      message: "The Hyperliquid practice trade was already placed.",
      outsideRequest: existing,
    };
  }

  const configured = readHyperliquidTestnetExecutorConfig();
  if (!configured.config) {
    return {
      placed: false,
      message: "The protected Hyperliquid practice connection is not ready.",
    };
  }
  try {
    const artifact = await submitHyperliquidTestnetOrder({
      request,
      config: configured.config,
    });
    const recorded = await recordAgentServerExecutionRequest({
      request,
      readiness,
      status: "submitted",
      message: `Hyperliquid practice order ${artifact.orderId} was ${artifact.status}.`,
      artifact,
    });
    return {
      placed: true,
      message: "The Hyperliquid practice trade was placed.",
      outsideRequest: recorded.record,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The Hyperliquid practice trade could not be placed.";
    const recorded = await recordAgentServerExecutionRequest({
      request,
      readiness,
      status: "adapter_error",
      message,
    });
    return { placed: false, message, outsideRequest: recorded.record };
  }
}

function executionFromProposal(proposal: AgentTradeProposal): AgentExecutionRecord {
  const now = Date.now();
  return {
    id: newExecutionId(),
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
    executionMode: "paper",
    adapterStatus: "ready",
    externalOrderId: null,
    policyHash: proposal.policyHash,
    status: "open",
    openedAt: now,
    realizedPnlUsd: "0",
    version: 1,
  };
}

function newExecutionId(): string {
  try {
    return randomUUID();
  } catch {
    return `agent_execution_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}
