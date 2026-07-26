import { buildAgentPostTradeReview } from "@/lib/agents/postTradeReview";
import type {
  AgentExecutionRecord,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface CloseAgentExecutionInput {
  execution: AgentExecutionRecord;
  proposal?: AgentTradeProposal | null;
  realizedPnlUsd: string;
  now?: number;
}

export function closeAgentExecutionRecord({
  execution,
  proposal,
  realizedPnlUsd,
  now = Date.now(),
}: CloseAgentExecutionInput): AgentExecutionRecord {
  const pnl = normalizePnl(realizedPnlUsd);
  return {
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
}

function normalizePnl(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "0";
  return String(Math.round(parsed * 100) / 100);
}
