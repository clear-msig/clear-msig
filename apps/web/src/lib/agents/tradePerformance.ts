import {
  estimateAgentOpenTradePerformance,
  type AgentMarketDataSnapshot,
} from "@/lib/agents/marketData";
import type { AgentExecutionRecord } from "@/lib/agents/types";

export interface AgentTradePerformanceSummary {
  totalTrades: number;
  openTrades: number;
  closedTrades: number;
  pricedOpenTrades: number;
  realizedPnlUsd: string;
  estimatedOpenPnlUsd: string;
  combinedPnlUsd: string;
}

export function summarizeAgentTradePerformance(
  executions: AgentExecutionRecord[],
  marketByMarket: Record<string, AgentMarketDataSnapshot>,
): AgentTradePerformanceSummary {
  const open = executions.filter((execution) => execution.status === "open");
  const closed = executions.filter((execution) => execution.status === "closed");
  const realized = closed.reduce(
    (sum, execution) => sum + numberValue(execution.realizedPnlUsd),
    0,
  );
  const openPnl = open.reduce((sum, execution) => {
    const performance = estimateAgentOpenTradePerformance(
      execution,
      marketByMarket[execution.market.trim().toUpperCase()] ?? null,
    );
    return sum + numberValue(performance?.unrealizedPnlUsd);
  }, 0);
  const pricedOpenTrades = open.filter((execution) =>
    estimateAgentOpenTradePerformance(
      execution,
      marketByMarket[execution.market.trim().toUpperCase()] ?? null,
    ),
  ).length;
  return {
    totalTrades: executions.length,
    openTrades: open.length,
    closedTrades: closed.length,
    pricedOpenTrades,
    realizedPnlUsd: money(realized),
    estimatedOpenPnlUsd: money(openPnl),
    combinedPnlUsd: money(realized + openPnl),
  };
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: number): string {
  return String(Math.round(value * 100) / 100);
}
