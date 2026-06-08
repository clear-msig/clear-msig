import { randomUUID } from "crypto";
import { buildAgentTradeDecisionJournal } from "@/lib/agents/decisionJournal";
import {
  evaluateAgentServerProposal,
  getAgentServerWalletState,
  saveAgentServerProposal,
  type AgentServerProposalSaveResult,
} from "@/lib/agents/serverState";
import {
  listAgentInboxSignals,
  removeAgentInboxSignals,
} from "@/lib/agents/serverInbox";
import type {
  AgentPolicyEvaluation,
  AgentProfile,
  AgentSignalInboxItem,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface AgentInboxImportResult {
  imported: Array<{
    item: AgentSignalInboxItem;
    proposal: AgentTradeProposal;
    evaluation: AgentPolicyEvaluation | null;
    duplicate: boolean;
  }>;
  skipped: Array<{
    item: AgentSignalInboxItem;
    reason: string;
    evaluation?: AgentPolicyEvaluation | null;
  }>;
  removed: number;
}

export async function importAgentInboxSignals({
  walletName,
  agentId,
  ids,
  allowedOnly = false,
}: {
  walletName: string;
  agentId: string;
  ids: string[];
  allowedOnly?: boolean;
}): Promise<AgentInboxImportResult> {
  const requested = new Set(ids);
  const inbox = await listAgentInboxSignals(walletName, agentId);
  const selected = inbox.filter((item) => requested.has(item.id));
  const imported: AgentInboxImportResult["imported"] = [];
  const skipped: AgentInboxImportResult["skipped"] = [];
  const removeIds: string[] = [];

  for (const item of selected) {
    const draft = await buildServerProposalFromInboxItem(item);
    if (!draft) {
      skipped.push({
        item,
        reason: "Trading agent is not present in backend agent state.",
      });
      continue;
    }

    const evaluation = await evaluateAgentServerProposal(draft.proposal);
    if (!evaluation) {
      skipped.push({
        item,
        reason: "Trade signal could not be evaluated against backend state.",
      });
      continue;
    }
    if (allowedOnly && evaluation.decision !== "allowed") {
      skipped.push({
        item,
        reason: "Trade signal is not allowed by the active backend session.",
        evaluation,
      });
      continue;
    }

    const proposalWithJournal: AgentTradeProposal = {
      ...draft.proposal,
      decisionJournal: buildAgentTradeDecisionJournal({
        agent: draft.agent,
        proposal: draft.proposal,
        evaluation,
        technicalSummary: item.payload.technicalSummary,
        fundamentalSummary: item.payload.fundamentalSummary,
        newsSummary: item.payload.newsSummary,
        riskPlan: item.payload.riskPlan,
        exitPlan: item.payload.exitPlan,
        invalidation: item.payload.invalidation,
      }),
    };

    const saved: AgentServerProposalSaveResult =
      await saveAgentServerProposal(proposalWithJournal);
    imported.push({
      item,
      proposal: saved.proposal,
      evaluation: saved.evaluation ?? evaluation,
      duplicate: saved.duplicate,
    });
    removeIds.push(item.id);
  }

  const removed = removeIds.length
    ? await removeAgentInboxSignals(walletName, agentId, removeIds)
    : 0;
  return { imported, skipped, removed };
}

async function buildServerProposalFromInboxItem(
  item: AgentSignalInboxItem,
): Promise<{ proposal: AgentTradeProposal; agent: AgentProfile } | null> {
  const state = await getAgentServerWalletState(item.walletName);
  const agent = state.agents.find((entry) => entry.id === item.agentId);
  if (!agent) return null;
  const now = Date.now();
  const submittedAt =
    typeof item.payload.submittedAt === "number" &&
    Number.isFinite(item.payload.submittedAt) &&
    item.payload.submittedAt > 0
      ? item.payload.submittedAt
      : item.receivedAt || now;
  const expiresAt =
    submittedAt + Math.max(1, item.payload.expiresInMinutes ?? 15) * 60 * 1000;

  return {
    agent,
    proposal: {
      id: newServerProposalId(),
      walletName: item.walletName,
      agentId: agent.id,
      venue: item.payload.venue,
      market: item.payload.market.trim().toUpperCase(),
      side: item.payload.side,
      orderType: item.payload.orderType ?? "market",
      notionalUsd: item.payload.notionalUsd.trim(),
      leverage: item.payload.leverage,
      entryPrice: item.payload.entryPrice ?? null,
      stopLossPrice: item.payload.stopLossPrice ?? null,
      takeProfitPrice: item.payload.takeProfitPrice ?? null,
      thesis: item.payload.thesis?.trim() || undefined,
      confidence: clamp(item.payload.confidence ?? 70, 0, 100),
      clientSignalId: item.payload.clientSignalId,
      expiresAt,
      status: "draft",
      createdAt: submittedAt,
      updatedAt: now,
      version: 1,
    },
  };
}

function newServerProposalId(): string {
  try {
    return randomUUID();
  } catch {
    return `agent_proposal_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
