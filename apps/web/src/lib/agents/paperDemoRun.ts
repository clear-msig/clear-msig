import { setupAgentBetaDemo } from "@/lib/agents/betaDemoSetup";
import {
  agentLeaderboard,
  closeMockAgentExecution,
  listAgentEvents,
  listAgentExecutions,
  listAgentScorecards,
} from "@/features/agents/local-state/store";
import type {
  AgentAuditEventKind,
  AgentExecutionRecord,
  AgentLeaderboardEntry,
  AgentScorecard,
} from "@/lib/agents/types";

const FIRST_TRADE_PREFIX = "clearsig-beta-demo:first-trade";
const DEMO_HISTORY_AGENT_PREFIX = "clearsig-demo-agent:";

export interface AgentPaperDemoChecklistItem {
  id:
    | "setup"
    | "paper_trade"
    | "pnl"
    | "scorecard"
    | "leaderboard"
    | "audit"
    | "history";
  label: string;
  passed: boolean;
  detail: string;
}

export interface AgentPaperDemoRunResult {
  agentId: string;
  sessionId: string;
  closedExecution: AgentExecutionRecord | null;
  scorecard: AgentScorecard | null;
  leaderboardEntry: AgentLeaderboardEntry | null;
  checklist: AgentPaperDemoChecklistItem[];
}

export function runAgentPaperTradingDemo({
  walletName,
  now = Date.now(),
  realizedPnlUsd = "12.5",
}: {
  walletName: string;
  now?: number;
  realizedPnlUsd?: string;
}): AgentPaperDemoRunResult {
  const setup = setupAgentBetaDemo({ walletName, now });
  const openFirstTrade = firstTradeExecution(walletName, setup.agent.id, "open");
  const closedExecution =
    openFirstTrade
      ? closeMockAgentExecution(walletName, openFirstTrade.id, realizedPnlUsd)
      : firstTradeExecution(walletName, setup.agent.id, "closed");
  const scorecard =
    listAgentScorecards(walletName).find((item) => item.agentId === setup.agent.id) ?? null;
  const leaderboard = agentLeaderboard(walletName);
  const leaderboardEntry =
    leaderboard.find((item) => item.agentId === setup.agent.id) ?? null;
  const firstTradeEvents = eventKindsForExecution(walletName, closedExecution);
  const allowedMarkets = setup.session.allowedMarkets ?? [];
  const allowedVenues = setup.session.allowedVenues ?? [];
  const historyTrades = listAgentExecutions(walletName).filter(
    (execution) =>
      execution.status === "closed" &&
      execution.agentId.startsWith(DEMO_HISTORY_AGENT_PREFIX),
  ).length;

  return {
    agentId: setup.agent.id,
    sessionId: setup.session.id,
    closedExecution,
    scorecard,
    leaderboardEntry,
    checklist: [
      {
        id: "setup",
        label: "Demo policy and allowance",
        passed: setup.session.status === "active",
        detail: `${allowedMarkets.join(", ")} on ${allowedVenues.join(", ")}`,
      },
      {
        id: "paper_trade",
        label: "Paper trade opened and closed",
        passed: closedExecution?.status === "closed",
        detail: closedExecution
          ? `${closedExecution.market} ${closedExecution.side} closed`
          : "No beta demo paper trade found.",
      },
      {
        id: "pnl",
        label: "PnL recorded",
        passed: closedExecution?.realizedPnlUsd === realizedPnlUsd,
        detail: closedExecution
          ? `${closedExecution.realizedPnlUsd} realized PnL`
          : "No closed execution PnL.",
      },
      {
        id: "scorecard",
        label: "Scorecard updated",
        passed:
          Boolean(scorecard) &&
          (scorecard?.executed ?? 0) > 0 &&
          Number(scorecard?.realizedPnlUsd ?? 0) !== 0,
        detail: scorecard
          ? `${scorecard.executed} executed, ${scorecard.realizedPnlUsd} realized PnL`
          : "No scorecard found.",
      },
      {
        id: "leaderboard",
        label: "Leaderboard includes demo trader",
        passed: Boolean(leaderboardEntry),
        detail: leaderboardEntry
          ? `Score ${leaderboardEntry.score}`
          : "Demo trader is missing from leaderboard.",
      },
      {
        id: "audit",
        label: "Audit trail recorded",
        passed: hasRequiredAuditTrail(firstTradeEvents),
        detail:
          firstTradeEvents.size > 0
            ? Array.from(firstTradeEvents).sort().join(", ")
            : "No first-trade audit events found.",
      },
      {
        id: "history",
        label: "Demo history available",
        passed: historyTrades > 0,
        detail: `${historyTrades} closed history trade${historyTrades === 1 ? "" : "s"}`,
      },
    ],
  };
}

function firstTradeExecution(
  walletName: string,
  agentId: string,
  status: AgentExecutionRecord["status"],
): AgentExecutionRecord | null {
  return (
    listAgentExecutions(walletName).find(
      (execution) =>
        execution.agentId === agentId &&
        execution.status === status &&
        execution.proposalId.startsWith(FIRST_TRADE_PREFIX),
    ) ?? null
  );
}

function eventKindsForExecution(
  walletName: string,
  execution: AgentExecutionRecord | null,
): Set<AgentAuditEventKind> {
  if (!execution) return new Set();
  return new Set(
    listAgentEvents(walletName)
      .filter(
        (event) =>
          event.executionId === execution.id ||
          event.proposalId === execution.proposalId,
      )
      .map((event) => event.kind),
  );
}

function hasRequiredAuditTrail(events: Set<AgentAuditEventKind>): boolean {
  return (
    events.has("proposal_created") &&
    events.has("proposal_executed") &&
    events.has("execution_opened") &&
    events.has("execution_closed")
  );
}
