import { agentLibraryMetrics } from "@/lib/agents/libraryMetrics";
import {
  buildAgentTrackRecordBook,
  executionTrackRecordSource,
  proposalTrackRecordSource,
  trackRecordSourceLabel,
  type AgentTrackRecordLane,
} from "@/lib/agents/trackRecord";
import type { AgentServerWalletState } from "@/lib/agents/serverState";
import type {
  AgentExecutionRecord,
  AgentLeaderboardEntry,
  AgentProfile,
  AgentScorecard,
  AgentTrackRecordSource,
  AgentTradeProposal,
  TradingVenue,
  TradeSide,
} from "@/lib/agents/types";

export interface AgentPublicProfileLane {
  source: AgentTrackRecordSource;
  label: string;
  summary: string;
  rank: number | null;
  score: number | null;
  realizedPnlUsd: string | null;
  closedTrades: number | null;
  openTrades: number | null;
  winRatePct: number | null;
  maxDrawdownPct: number | null;
  ruleViolations: number | null;
  proposals: number | null;
  executed: number | null;
  hasHistory: boolean;
}

export interface AgentPublicProfileTrade {
  market: string;
  side: TradeSide;
  venue: TradingVenue;
  source: AgentTrackRecordSource;
  status: "open" | "closed";
  notionalUsd: string;
  leverage: number;
  realizedPnlUsd: string;
  openedAt: number;
  closedAt?: number | null;
  postTradeSummary?: string;
}

export interface AgentPublicProfileDecision {
  market: string;
  side: TradeSide;
  venue: TradingVenue;
  source: AgentTrackRecordSource;
  status: AgentTradeProposal["status"];
  confidence: number;
  summary: string;
  entryReason?: string;
  riskPlan?: string;
  exitPlan?: string;
  policySummary?: string;
  evidence: Array<{ label: string; summary: string; source?: string }>;
  createdAt: number;
}

export interface AgentPublicProfile {
  walletName: string;
  agentId: string;
  name: string;
  slug: string;
  kind: AgentProfile["kind"];
  status: AgentProfile["status"];
  summary: string;
  strategySummary?: string;
  allowedMarkets: string[];
  supportedVenues: TradingVenue[];
  creatorLabel: string;
  identityPubkey?: string;
  publishedAt?: number;
  reviewedAt?: number;
  reviewReason?: string;
  primarySource: AgentTrackRecordSource;
  lanes: AgentPublicProfileLane[];
  recentTrades: AgentPublicProfileTrade[];
  recentDecisions: AgentPublicProfileDecision[];
  disclosures: string[];
  updatedAt: number;
}

export function buildAgentPublicProfile({
  state,
  slug,
  now = Date.now(),
}: {
  state: AgentServerWalletState;
  slug: string;
  now?: number;
}): AgentPublicProfile | null {
  const normalizedSlug = normalizeSlug(slug);
  const agent = state.agents.find(
    (item) =>
      item.publishing?.status === "published" &&
      normalizeSlug(item.publishing.slug) === normalizedSlug,
  );
  if (!agent || !isPubliclyVisible(agent)) return null;

  const agentProposals = state.proposals.filter((proposal) => proposal.agentId === agent.id);
  const agentExecutions = state.executions.filter((execution) => execution.agentId === agent.id);
  const book = buildAgentTrackRecordBook({
    agents: state.agents,
    proposals: state.proposals,
    executions: state.executions,
    now,
  });
  const visible = new Set(agent.publishing?.visibleMetrics ?? []);
  const lanes = book.lanes.map((lane) =>
    publicLane({
      lane,
      agent,
      executions: agentExecutions.filter(
        (execution) => executionTrackRecordSource(execution) === lane.source,
      ),
      visible,
      now,
    }),
  );
  const primarySource =
    lanes.find((lane) => lane.source === book.primarySource && lane.hasHistory)?.source ??
    lanes.find((lane) => lane.hasHistory)?.source ??
    book.primarySource;

  return {
    walletName: state.walletName,
    agentId: agent.id,
    name: agent.name,
    slug: agent.publishing?.slug ?? normalizedSlug,
    kind: agent.kind,
    status: agent.status,
    summary:
      agent.publishing?.publicSummary?.trim() ||
      agent.description?.trim() ||
      `${agent.name} trading profile`,
    strategySummary: agent.strategy?.summary,
    allowedMarkets: agent.strategy?.allowedMarkets ?? uniqueMarkets(agentProposals, agentExecutions),
    supportedVenues: uniqueVenues(agentProposals, agentExecutions),
    creatorLabel: agent.libraryTraderId ? "ClearSig prepared agent" : "External creator agent",
    identityPubkey: agent.identityPubkey,
    publishedAt: agent.publishing?.publishedAt,
    reviewedAt: agent.publishing?.moderation?.reviewedAt,
    reviewReason: agent.publishing?.moderation?.reason,
    primarySource,
    lanes,
    recentTrades: recentTrades(agentExecutions),
    recentDecisions: recentDecisions(agentProposals),
    disclosures: [
      "ClearSig does not host, train, or custody creator-owned agents by default.",
      "Agents submit trade decisions. ClearSig checks user permissions and risk rules before execution.",
      "Paper, testnet, and verified live results are separated because they carry different risk meaning.",
      "Past performance and reasoning quality do not guarantee future results.",
    ],
    updatedAt: Math.max(
      state.updatedAt,
      agent.updatedAt,
      ...agentProposals.map((proposal) => proposal.updatedAt),
      ...agentExecutions.map((execution) => execution.closedAt ?? execution.openedAt),
    ),
  };
}

export function isPubliclyVisible(agent: AgentProfile): boolean {
  return (
    agent.publishing?.status === "published" &&
    agent.publishing.moderation?.status === "approved"
  );
}

function publicLane({
  lane,
  agent,
  executions,
  visible,
  now,
}: {
  lane: AgentTrackRecordLane;
  agent: AgentProfile;
  executions: AgentExecutionRecord[];
  visible: Set<string>;
  now: number;
}): AgentPublicProfileLane {
  const scorecard = lane.scorecards.find((item) => item.agentId === agent.id);
  const leaderboard = lane.leaderboard.find((item) => item.agentId === agent.id);
  const metrics = agentLibraryMetrics({ agent, scorecard, executions, now });
  return {
    source: lane.source,
    label: lane.label,
    summary: lane.summary,
    rank: rankInLane(lane, leaderboard),
    score: show(visible, "score") ? (leaderboard?.score ?? null) : null,
    realizedPnlUsd: show(visible, "realized_pnl") ? (scorecard?.realizedPnlUsd ?? "0") : null,
    closedTrades: show(visible, "closed_trades") ? metrics.closedTrades : null,
    openTrades: show(visible, "open_trades") ? metrics.openTrades : null,
    winRatePct: show(visible, "win_rate") ? metrics.winRatePct : null,
    maxDrawdownPct: scorecard?.maxDrawdownPct ?? null,
    ruleViolations: show(visible, "safety_stops") ? (scorecard?.ruleViolations ?? 0) : null,
    proposals: scorecard?.proposals ?? null,
    executed: scorecard?.executed ?? null,
    hasHistory: metrics.hasHistory,
  };
}

function recentTrades(executions: AgentExecutionRecord[]): AgentPublicProfileTrade[] {
  return [...executions]
    .sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt))
    .slice(0, 8)
    .map((execution) => ({
      market: execution.market,
      side: execution.side,
      venue: execution.venue,
      source: executionTrackRecordSource(execution),
      status: execution.status,
      notionalUsd: execution.notionalUsd,
      leverage: execution.leverage,
      realizedPnlUsd: execution.realizedPnlUsd,
      openedAt: execution.openedAt,
      closedAt: execution.closedAt,
      postTradeSummary: execution.postTradeReview?.summary,
    }));
}

function recentDecisions(proposals: AgentTradeProposal[]): AgentPublicProfileDecision[] {
  return [...proposals]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 6)
    .map((proposal) => ({
      market: proposal.market,
      side: proposal.side,
      venue: proposal.venue,
      source: proposalTrackRecordSource(proposal),
      status: proposal.status,
      confidence: proposal.confidence,
      summary:
        proposal.decisionJournal?.summary ||
        proposal.thesis ||
        `${proposal.side} ${proposal.market} decision`,
      entryReason: proposal.decisionJournal?.entryReason,
      riskPlan: proposal.decisionJournal?.riskPlan,
      exitPlan: proposal.decisionJournal?.exitPlan,
      policySummary: proposal.decisionJournal?.policySummary,
      evidence:
        proposal.decisionJournal?.evidence.slice(0, 4).map((item) => ({
          label: item.label,
          summary: item.summary,
          source: item.source,
        })) ?? [],
      createdAt: proposal.createdAt,
    }));
}

function rankInLane(
  lane: AgentTrackRecordLane,
  leaderboard: AgentLeaderboardEntry | undefined,
): number | null {
  if (!leaderboard) return null;
  const index = lane.leaderboard.findIndex((entry) => entry.agentId === leaderboard.agentId);
  return index >= 0 ? index + 1 : null;
}

function show(visible: Set<string>, metric: string): boolean {
  return visible.size === 0 || visible.has(metric);
}

function uniqueMarkets(
  proposals: AgentTradeProposal[],
  executions: AgentExecutionRecord[],
): string[] {
  return Array.from(
    new Set([...proposals.map((item) => item.market), ...executions.map((item) => item.market)]),
  )
    .map((market) => market.trim().toUpperCase())
    .filter(Boolean)
    .sort();
}

function uniqueVenues(
  proposals: AgentTradeProposal[],
  executions: AgentExecutionRecord[],
): TradingVenue[] {
  return Array.from(
    new Set([...proposals.map((item) => item.venue), ...executions.map((item) => item.venue)]),
  ).sort();
}

function normalizeSlug(value: string): string {
  return value.trim().toLowerCase();
}

export function publicProfileUrl(walletName: string, slug: string): string {
  return `/agents/${encodeURIComponent(walletName)}/${encodeURIComponent(slug)}`;
}

export function publicProfileSourceLabel(source: AgentTrackRecordSource): string {
  return trackRecordSourceLabel(source);
}
