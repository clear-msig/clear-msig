import { rankAgents } from "@/lib/agents/scoring";
import type {
  AgentExecutionRecord,
  AgentLeaderboardEntry,
  AgentProfile,
  AgentScorecard,
  AgentTrackRecordSource,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface AgentTrackRecordLane {
  source: AgentTrackRecordSource;
  label: string;
  summary: string;
  leaderboard: AgentLeaderboardEntry[];
  scorecards: AgentScorecard[];
  tradeCount: number;
  closedTrades: number;
  realizedPnlUsd: string;
}

export interface AgentTrackRecordBook {
  lanes: AgentTrackRecordLane[];
  primarySource: AgentTrackRecordSource;
  separated: boolean;
}

export const AGENT_TRACK_RECORD_SOURCES: readonly AgentTrackRecordSource[] = [
  "paper",
  "testnet",
  "verified_live",
] as const;

export function buildAgentTrackRecordBook({
  agents,
  proposals,
  executions,
  now = Date.now(),
}: {
  agents: AgentProfile[];
  proposals: AgentTradeProposal[];
  executions: AgentExecutionRecord[];
  now?: number;
}): AgentTrackRecordBook {
  const lanes = AGENT_TRACK_RECORD_SOURCES.map((source) =>
    buildAgentTrackRecordLane({
      source,
      agents,
      proposals,
      executions,
      now,
    }),
  );
  const primarySource =
    lanes.find((lane) => lane.source === "verified_live" && lane.tradeCount > 0)?.source ??
    lanes.find((lane) => lane.source === "testnet" && lane.tradeCount > 0)?.source ??
    "paper";

  return {
    lanes,
    primarySource,
    separated: true,
  };
}

export function buildAgentTrackRecordLane({
  source,
  agents,
  proposals,
  executions,
  now = Date.now(),
}: {
  source: AgentTrackRecordSource;
  agents: AgentProfile[];
  proposals: AgentTradeProposal[];
  executions: AgentExecutionRecord[];
  now?: number;
}): AgentTrackRecordLane {
  const scorecards = agents.map((agent) =>
    buildAgentTrackRecordScorecard({
      agent,
      proposals: proposals.filter(
        (proposal) =>
          proposal.agentId === agent.id &&
          proposalTrackRecordSource(proposal) === source,
      ),
      executions: executions.filter(
        (execution) =>
          execution.agentId === agent.id &&
          executionTrackRecordSource(execution) === source,
      ),
      now,
    }),
  );
  const leaderboard = rankAgents(scorecards)
    .filter((entry) => {
      const scorecard = scorecards.find((item) => item.agentId === entry.agentId);
      return hasTrackRecordActivity(scorecard);
    })
    .map((entry) => ({ ...entry, trackRecordSource: source }));
  const laneExecutions = executions.filter(
    (execution) => executionTrackRecordSource(execution) === source,
  );
  const closed = laneExecutions.filter((execution) => execution.status === "closed");

  return {
    source,
    label: trackRecordSourceLabel(source),
    summary: trackRecordSourceSummary(source),
    leaderboard,
    scorecards,
    tradeCount: laneExecutions.length,
    closedTrades: closed.length,
    realizedPnlUsd: formatMoney(
      closed.reduce((total, execution) => total + numberValue(execution.realizedPnlUsd), 0),
    ),
  };
}

export function buildAgentTrackRecordScorecard({
  agent,
  proposals,
  executions,
  now = Date.now(),
}: {
  agent: AgentProfile;
  proposals: AgentTradeProposal[];
  executions: AgentExecutionRecord[];
  now?: number;
}): AgentScorecard {
  const closed = executions.filter((execution) => execution.status === "closed");
  const realizedPnl = closed.reduce(
    (total, execution) => total + numberValue(execution.realizedPnlUsd),
    0,
  );
  const maxDrawdownPct = closed.reduce((max, execution) => {
    const pnl = numberValue(execution.realizedPnlUsd);
    const notional = numberValue(execution.notionalUsd);
    if (pnl >= 0 || notional <= 0) return max;
    return Math.max(max, Math.abs(pnl / notional) * 100);
  }, 0);

  return {
    walletName: agent.walletName,
    agentId: agent.id,
    proposals: proposals.length,
    approved: proposals.filter((proposal) =>
      ["approved", "executed"].includes(proposal.status),
    ).length,
    rejected: proposals.filter((proposal) => proposal.status === "rejected").length,
    blocked: proposals.filter((proposal) => proposal.status === "blocked").length,
    executed: executions.length,
    ruleViolations: proposals.reduce(
      (total, proposal) => total + (proposal.policyViolations?.length ?? 0),
      0,
    ),
    realizedPnlUsd: formatMoney(realizedPnl),
    maxDrawdownPct: round(maxDrawdownPct),
    humanOverrideCount: proposals.filter(
      (proposal) => proposal.evaluationDecision === "requires_human_approval",
    ).length,
    updatedAt: Math.max(
      now,
      ...proposals.map((proposal) => proposal.updatedAt),
      ...executions.map((execution) => execution.closedAt ?? execution.openedAt),
    ),
    version: 1,
  };
}

export function executionTrackRecordSource(
  execution: AgentExecutionRecord,
): AgentTrackRecordSource {
  if ((execution.executionMode as string | undefined) === "live") {
    return execution.externalOrderId ? "verified_live" : "testnet";
  }
  if (execution.executionMode === "testnet" || execution.venue === "hyperliquid_testnet") {
    return "testnet";
  }
  return "paper";
}

export function proposalTrackRecordSource(
  proposal: AgentTradeProposal,
): AgentTrackRecordSource {
  if (proposal.venue === "hyperliquid_testnet") return "testnet";
  return "paper";
}

export function trackRecordSourceLabel(source: AgentTrackRecordSource): string {
  switch (source) {
    case "paper":
      return "Paper";
    case "testnet":
      return "Testnet";
    case "verified_live":
      return "Verified live";
  }
}

export function trackRecordSourceSummary(source: AgentTrackRecordSource): string {
  switch (source) {
    case "paper":
      return "Built-in simulated trades. Useful for UX and strategy dry runs.";
    case "testnet":
      return "Exchange testnet trades. Useful for adapter and execution testing.";
    case "verified_live":
      return "Real venue fills reconciled by ClearSig. Required before creator payouts.";
  }
}

function hasTrackRecordActivity(scorecard: AgentScorecard | undefined): boolean {
  return Boolean(
    scorecard &&
      (scorecard.proposals > 0 ||
        scorecard.executed > 0 ||
        numberValue(scorecard.realizedPnlUsd) !== 0),
  );
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return String(round(value));
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
