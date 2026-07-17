import type {
  AgentExecutionRecord,
  AgentProfile,
  AgentScorecard,
} from "@/lib/agents/types";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AgentLibraryMetrics {
  ageDays: number;
  closedTrades: number;
  openTrades: number;
  winRatePct: number | null;
  sevenDayPnlUsd: string;
  thirtyDayPnlUsd: string;
  lastTradedAt: number | null;
  hasHistory: boolean;
}

export function agentLibraryMetrics({
  agent,
  scorecard,
  executions,
  now = Date.now(),
}: {
  agent: AgentProfile;
  scorecard?: AgentScorecard | null;
  executions: AgentExecutionRecord[];
  now?: number;
}): AgentLibraryMetrics {
  const agentExecutions = executions.filter((execution) => execution.agentId === agent.id);
  const closed = agentExecutions.filter((execution) => execution.status === "closed");
  const open = agentExecutions.filter((execution) => execution.status === "open");
  const wins = closed.filter((execution) => Number(execution.realizedPnlUsd || 0) > 0);
  const lastTradedAt =
    agentExecutions.reduce<number | null>((latest, execution) => {
      const timestamp = execution.closedAt ?? execution.openedAt;
      return latest == null || timestamp > latest ? timestamp : latest;
    }, null) ?? null;
  const ageDays = Math.max(0, Math.floor((now - agent.createdAt) / DAY_MS));

  return {
    ageDays,
    closedTrades: closed.length,
    openTrades: open.length,
    winRatePct: closed.length > 0 ? Math.round((wins.length / closed.length) * 100) : null,
    sevenDayPnlUsd: formatMoney(windowPnl(closed, now, 7)),
    thirtyDayPnlUsd: formatMoney(windowPnl(closed, now, 30)),
    lastTradedAt,
    hasHistory:
      closed.length > 0 ||
      open.length > 0 ||
      (scorecard?.proposals ?? 0) > 0 ||
      (scorecard?.executed ?? 0) > 0,
  };
}

function windowPnl(
  executions: AgentExecutionRecord[],
  now: number,
  days: number,
): number {
  const cutoff = now - days * DAY_MS;
  return executions
    .filter((execution) => (execution.closedAt ?? execution.openedAt) >= cutoff)
    .reduce((sum, execution) => sum + numberValue(execution.realizedPnlUsd), 0);
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value: number): string {
  return String(Math.round(value * 100) / 100);
}
