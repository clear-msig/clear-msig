import {
  fetchAgentMarketUniverse,
} from "@/lib/agents/serverMarketDataAdapters";
import {
  buildAgentScoutProposal,
  buildAgentScoutReports,
  type AgentScoutReport,
} from "@/lib/agents/scout";
import { executeAllowedAgentProposal } from "@/lib/agents/serverAutomaticExecution";
import {
  getAgentServerWalletState,
  saveAgentServerProposal,
} from "@/features/agents/server/serverState";
import type {
  AgentAutomaticExecutionResult,
} from "@/lib/agents/serverAutomaticExecution";
import type {
  AgentMarketDataSnapshot,
  AgentMarketUniverseItem,
} from "@/lib/agents/marketData";
import type {
  AgentProfile,
  AgentRiskSnapshot,
  AgentSessionGrant,
  AgentTradeProposal,
  TradingVenue,
} from "@/lib/agents/types";

export interface AgentAutonomyTickInput {
  walletName: string;
  agentId?: string | null;
  venue?: TradingVenue;
  maxMarkets?: number;
  maxIdeas?: number;
  now?: number;
  fetchImpl?: typeof fetch;
}

export interface AgentAutonomyTickResult {
  ok: true;
  walletName: string;
  venue: TradingVenue;
  scannedMarkets: number;
  consideredMarkets: number;
  reports: AgentScoutReport[];
  proposals: Array<{
    proposal: AgentTradeProposal;
    duplicate: boolean;
    execution: AgentAutomaticExecutionResult | null;
  }>;
  message: string;
}

const DEFAULT_MAX_MARKETS = 40;
const DEFAULT_MAX_IDEAS = 3;

export async function runAgentAutonomyTick({
  walletName,
  agentId,
  venue = "hyperliquid_testnet",
  maxMarkets = DEFAULT_MAX_MARKETS,
  maxIdeas = DEFAULT_MAX_IDEAS,
  now = Date.now(),
  fetchImpl = fetch,
}: AgentAutonomyTickInput): Promise<AgentAutonomyTickResult> {
  const state = await getAgentServerWalletState(walletName);
  const sessions = activeSessionsForVenue(state.sessions, venue, now);
  const agents = state.agents
    .filter((agent) => agent.status === "active")
    .filter((agent) => !agentId || agent.id === agentId)
    .filter((agent) => sessions.some((session) => session.agentId === agent.id));

  if (agents.length === 0) {
    return {
      ok: true,
      walletName: state.walletName,
      venue,
      scannedMarkets: 0,
      consideredMarkets: 0,
      reports: [],
      proposals: [],
      message:
        "No active agent has an owner-approved session for this venue. Create a bounded session before autonomy can trade.",
    };
  }

  const universe = await fetchAgentMarketUniverse({
    provider: marketProviderForVenue(venue),
    limit: clampInt(maxMarkets, 1, 250),
    now,
    fetchImpl,
  });
  const tradableUniverse = universe.filter((market) => market.tradable);
  const marketByMarket = marketSnapshotsByMarket(tradableUniverse);
  const reports = buildAgentScoutReports({
    agents,
    policy: state.policy,
    sessions,
    marketByMarket,
    risksByAgent: risksByAgent(state.executions, agents, now),
    now,
  })
    .filter((report) => report.venue === venue)
    .filter((report) => report.status === "ready")
    .slice(0, clampInt(maxIdeas, 1, 10));

  const proposals: AgentAutonomyTickResult["proposals"] = [];
  for (const report of reports) {
    const agent = agents.find((item) => item.id === report.agentId);
    if (!agent) continue;
    const session = sessions.find((item) => item.agentId === agent.id) ?? null;
    const proposalResult = buildAgentScoutProposal({
      report,
      agent,
      policy: state.policy,
      session,
      risk: risksByAgent(state.executions, [agent], now)[agent.id],
      id: newAutonomyProposalId(report, now),
      now,
    });
    const saved = await saveAgentServerProposal(proposalResult.proposal);
    const execution =
      saved.proposal.status === "approved"
        ? await executeAllowedAgentProposal(saved.proposal)
        : null;
    proposals.push({
      proposal: saved.proposal,
      duplicate: saved.duplicate,
      execution,
    });
  }

  return {
    ok: true,
    walletName: state.walletName,
    venue,
    scannedMarkets: universe.length,
    consideredMarkets: tradableUniverse.length,
    reports,
    proposals,
    message:
      proposals.length > 0
        ? `Autonomy tick prepared ${proposals.length} policy-approved idea${proposals.length === 1 ? "" : "s"}.`
        : "Autonomy tick scanned live markets, but no idea passed the current ClearSig policy gate.",
  };
}

function activeSessionsForVenue(
  sessions: AgentSessionGrant[],
  venue: TradingVenue,
  now: number,
): AgentSessionGrant[] {
  return sessions.filter(
    (session) =>
      session.status === "active" &&
      session.startsAt <= now &&
      session.expiresAt > now &&
      (session.allowedVenues ?? []).includes(venue),
  );
}

function marketProviderForVenue(venue: TradingVenue): "mock" | "hyperliquid" {
  return venue === "hyperliquid_testnet" ? "hyperliquid" : "mock";
}

function marketSnapshotsByMarket(
  universe: AgentMarketUniverseItem[],
): Record<string, AgentMarketDataSnapshot> {
  return Object.fromEntries(
    universe
      .filter((item) => item.markPriceUsd != null)
      .map((item) => [
        item.market,
        {
          provider: item.provider,
          source: item.source,
          market: item.market,
          observedAt: item.observedAt,
          markPriceUsd: item.markPriceUsd ?? "0",
          fundingRatePct: item.fundingRatePct,
          openInterestUsd: item.openInterestUsd,
          volume24hUsd: item.volume24hUsd,
        },
      ]),
  );
}

function risksByAgent(
  executions: Array<{
    agentId: string;
    status: "open" | "closed";
    openedAt: number;
    closedAt?: number | null;
    realizedPnlUsd: string;
  }>,
  agents: AgentProfile[],
  now: number,
): Record<string, AgentRiskSnapshot> {
  return Object.fromEntries(
    agents.map((agent) => {
      const rows = executions.filter((execution) => execution.agentId === agent.id);
      return [
        agent.id,
        {
          openPositions: rows.filter((execution) => execution.status === "open").length,
          lastTradeAt: rows.reduce<number | null>(
            (latest, execution) =>
              latest == null || execution.openedAt > latest ? execution.openedAt : latest,
            null,
          ),
          dailyRealizedPnlUsd: String(dailyRealizedPnl(rows, now)),
          realizedPnlUsd: String(
            roundMoney(
              rows
                .filter((execution) => execution.status === "closed")
                .reduce(
                  (sum, execution) => sum + Number(execution.realizedPnlUsd || 0),
                  0,
                ),
            ),
          ),
          maxDrawdownPct: 0,
        },
      ];
    }),
  );
}

function dailyRealizedPnl(
  executions: Array<{ status: "open" | "closed"; closedAt?: number | null; realizedPnlUsd: string }>,
  now: number,
): number {
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  return roundMoney(
    executions
      .filter(
        (execution) =>
          execution.status === "closed" &&
          (execution.closedAt ?? 0) >= dayStart.getTime(),
      )
      .reduce((sum, execution) => sum + Number(execution.realizedPnlUsd || 0), 0),
  );
}

function newAutonomyProposalId(report: AgentScoutReport, now: number): string {
  return `autonomy_${report.agentId}_${report.market}_${now}`
    .replace(/[^A-Za-z0-9_:-]/g, "_")
    .slice(0, 96);
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}
