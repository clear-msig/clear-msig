import type { AgentMarketDataSnapshot } from "@/lib/agents/marketData";
import { buildAgentTradeDecisionJournal } from "@/lib/agents/decisionJournal";
import { evaluateAgentTradeProposal } from "@/lib/agents/policy";
import type {
  AgentPolicyEvaluation,
  AgentProposalStatus,
  AgentProfile,
  AgentRiskSnapshot,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
  TradeSide,
  TradingVenue,
} from "@/lib/agents/types";

export type AgentScoutStatus = "ready" | "needs_approval" | "blocked" | "watching";

export interface AgentScoutReport {
  id: string;
  agentId: string;
  agentName: string;
  market: string;
  side: TradeSide;
  venue: TradingVenue;
  status: AgentScoutStatus;
  score: number;
  headline: string;
  thesis: string;
  technicalSummary: string;
  fundamentalSummary: string;
  newsSummary: string;
  riskPlan: string;
  exitPlan: string;
  invalidation: string;
  policySummary: string;
  nextAction: string;
  snapshot?: AgentMarketDataSnapshot | null;
  evaluation?: AgentPolicyEvaluation;
  observedAt: number;
}

export interface BuildAgentScoutReportsInput {
  agents: AgentProfile[];
  policy: AgentVaultPolicy;
  sessions: AgentSessionGrant[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  risksByAgent: Record<string, AgentRiskSnapshot>;
  now?: number;
}

export interface BuildAgentScoutProposalInput {
  report: AgentScoutReport;
  agent: AgentProfile;
  policy: AgentVaultPolicy;
  session?: AgentSessionGrant | null;
  risk?: AgentRiskSnapshot;
  id: string;
  now?: number;
}

export interface AgentScoutProposalResult {
  proposal: AgentTradeProposal;
  evaluation: AgentPolicyEvaluation;
}

export function buildAgentScoutReports({
  agents,
  policy,
  sessions,
  marketByMarket,
  risksByAgent,
  now = Date.now(),
}: BuildAgentScoutReportsInput): AgentScoutReport[] {
  return agents
    .filter((agent) => agent.status === "active")
    .map((agent) => {
      const session = sessions.find(
        (item) =>
          item.agentId === agent.id &&
          item.status === "active" &&
          item.startsAt <= now &&
          item.expiresAt > now,
      );
      return buildAgentScoutReport({
        agent,
        policy,
        session,
        marketByMarket,
        risk: risksByAgent[agent.id],
        now,
      });
    })
    .sort((a, b) => b.score - a.score || a.agentName.localeCompare(b.agentName));
}

export function buildAgentScoutProposal({
  report,
  agent,
  policy,
  session,
  risk,
  id,
  now = Date.now(),
}: BuildAgentScoutProposalInput): AgentScoutProposalResult {
  const proposal = baseScoutProposal({
    report,
    agent,
    policy,
    session,
    id,
    now,
  });
  const evaluation = evaluateAgentTradeProposal({
    agent,
    proposal,
    policy,
    session,
    risk,
    now,
  });
  const checked: AgentTradeProposal = {
    ...proposal,
    status: proposalStatusForEvaluation(evaluation),
    evaluationDecision: evaluation.decision,
    policyViolations: evaluation.violations,
    decisionJournal: buildAgentTradeDecisionJournal({
      agent,
      proposal,
      evaluation,
      marketData: report.snapshot,
      technicalSummary: report.technicalSummary,
      fundamentalSummary: report.fundamentalSummary,
      newsSummary: report.newsSummary,
      riskPlan: report.riskPlan,
      exitPlan: report.exitPlan,
      invalidation: report.invalidation,
      now,
    }),
    updatedAt: now,
  };
  return { proposal: checked, evaluation };
}

function buildAgentScoutReport({
  agent,
  policy,
  session,
  marketByMarket,
  risk,
  now,
}: {
  agent: AgentProfile;
  policy: AgentVaultPolicy;
  session?: AgentSessionGrant;
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  risk?: AgentRiskSnapshot;
  now: number;
}): AgentScoutReport {
  const markets = candidateMarkets(agent, policy, session);
  const snapshot = bestSnapshot(markets, marketByMarket);
  const market = snapshot?.market ?? markets[0] ?? "BTC-PERP";
  const side = suggestedSide(agent, snapshot);
  const venue = suggestedVenue(policy, session);
  const draft = baseScoutProposal({
    report: {
      market,
      side,
      venue,
      thesis: "",
      snapshot,
    },
    agent,
    policy,
    session,
    id: "scout-draft",
    now,
  });
  const evaluation = evaluateAgentTradeProposal({
    agent,
    proposal: draft,
    policy,
    session,
    risk,
    now,
  });
  const status = statusForEvaluation(evaluation);
  const score = scoutScore({ snapshot, status, risk, session, policy });
  const technicalSummary = technicalRead({ market, side, snapshot });
  const riskPlan = riskRead({ draft, policy, session });
  const policySummary = policyRead(evaluation);

  return {
    id: `${agent.id}:${market}:${side}`,
    agentId: agent.id,
    agentName: agent.name,
    market,
    side,
    venue,
    status,
    score,
    headline: headlineFor({ agent, market, side, status, score }),
    thesis: thesisFor({ agent, market, side, snapshot }),
    technicalSummary,
    fundamentalSummary:
      "This pass uses the agent playbook, active allowance, and venue market data. External fundamentals are not connected to this scout yet.",
    newsSummary:
      "No connected news feed was used for this pass; the trade idea must stand on observable market data and the agent rules.",
    riskPlan,
    exitPlan: exitRead({ draft }),
    invalidation: invalidationRead({ draft }),
    policySummary,
    nextAction: nextActionFor(status),
    snapshot,
    evaluation,
    observedAt: snapshot?.observedAt ?? now,
  };
}

function baseScoutProposal({
  report,
  agent,
  policy,
  session,
  id,
  now,
}: {
  report: Pick<AgentScoutReport, "market" | "side" | "venue" | "snapshot" | "thesis">;
  agent: AgentProfile;
  policy: AgentVaultPolicy;
  session?: AgentSessionGrant | null;
  id: string;
  now: number;
}): AgentTradeProposal {
  const mark = positiveNumber(report.snapshot?.markPriceUsd, referencePrice(report.market));
  const notional = minPositive(
    [
      "100",
      policy.maxNotionalUsd,
      session?.maxNotionalUsd,
    ],
    25,
  );
  const leverage = Math.max(1, Math.min(policy.maxLeverage || 1, session?.maxLeverage ?? 1));
  const stopDistancePct = report.side === "long" ? 0.03 : -0.03;
  const targetDistancePct = report.side === "long" ? 0.05 : -0.05;

  return {
    id,
    walletName: agent.walletName,
    agentId: agent.id,
    venue: report.venue,
    market: report.market,
    side: report.side,
    orderType: "market",
    notionalUsd: formatMoney(notional),
    leverage,
    entryPrice: formatPrice(mark),
    stopLossPrice: formatPrice(mark * (1 - stopDistancePct)),
    takeProfitPrice: formatPrice(mark * (1 + targetDistancePct)),
    thesis:
      report.thesis ||
      `${agent.name} scouted ${report.market} and prepared a ${report.side} idea for ClearSig risk checks.`,
    confidence: Math.max(45, Math.min(82, Math.round(55 + (report.snapshot ? 10 : 0)))),
    clientSignalId: `clearsig-scout:${agent.id}:${report.market}:${now}`,
    expiresAt: now + 15 * 60 * 1000,
    status: "draft",
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
}

function candidateMarkets(
  agent: AgentProfile,
  policy: AgentVaultPolicy,
  session?: AgentSessionGrant,
): string[] {
  const strategyMarkets = agent.strategy?.allowedMarkets ?? [];
  const sessionMarkets = session?.allowedMarkets ?? [];
  const policyMarkets = policy.allowedMarkets ?? [];
  const preferred = strategyMarkets.length > 0 ? strategyMarkets : policyMarkets;
  const filtered = preferred.filter((market) => {
    const normalized = normalizeMarket(market);
    return (
      normalized &&
      (policyMarkets.length === 0 || policyMarkets.map(normalizeMarket).includes(normalized)) &&
      (sessionMarkets.length === 0 || sessionMarkets.map(normalizeMarket).includes(normalized))
    );
  });
  const fallback = filtered.length > 0 ? filtered : preferred;
  return [...new Set(fallback.map(normalizeMarket).filter(Boolean))].slice(0, 6);
}

function bestSnapshot(
  markets: string[],
  marketByMarket: Record<string, AgentMarketDataSnapshot>,
): AgentMarketDataSnapshot | null {
  const snapshots = markets
    .map((market) => marketByMarket[normalizeMarket(market)])
    .filter((snapshot): snapshot is AgentMarketDataSnapshot => Boolean(snapshot));
  if (snapshots.length === 0) return null;
  return snapshots.sort((a, b) => snapshotScore(b) - snapshotScore(a))[0] ?? null;
}

function snapshotScore(snapshot: AgentMarketDataSnapshot): number {
  return (
    positiveNumber(snapshot.volume24hUsd, 0) / 1_000_000 +
    positiveNumber(snapshot.openInterestUsd, 0) / 2_000_000 +
    Math.abs(positiveNumber(snapshot.fundingRatePct, 0)) * 100
  );
}

function suggestedSide(agent: AgentProfile, snapshot: AgentMarketDataSnapshot | null): TradeSide {
  const text = [
    agent.strategy?.summary,
    agent.strategy?.entryRules,
    agent.strategy?.exitRules,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (text.includes("defensive") || text.includes("protect") || text.includes("falling")) {
    return "short";
  }
  const funding = positiveNumber(snapshot?.fundingRatePct, 0);
  if (funding > 0.035) return "short";
  return "long";
}

function suggestedVenue(policy: AgentVaultPolicy, session?: AgentSessionGrant): TradingVenue {
  const venues = session?.allowedVenues?.length ? session.allowedVenues : policy.allowedVenues;
  if (venues.includes("mock_perps")) return "mock_perps";
  return venues[0] ?? "mock_perps";
}

function scoutScore({
  snapshot,
  status,
  risk,
  session,
  policy,
}: {
  snapshot: AgentMarketDataSnapshot | null;
  status: AgentScoutStatus;
  risk?: AgentRiskSnapshot;
  session?: AgentSessionGrant;
  policy: AgentVaultPolicy;
}): number {
  let score = 45;
  if (snapshot) score += snapshot.source === "live" ? 22 : 16;
  if (positiveNumber(snapshot?.volume24hUsd, 0) >= 1_000_000) score += 8;
  if (positiveNumber(snapshot?.openInterestUsd, 0) >= 1_000_000) score += 6;
  if (Math.abs(positiveNumber(snapshot?.fundingRatePct, 0)) >= 0.01) score += 4;
  if (session) score += 6;
  if (!policy.enabled || policy.emergencyPaused) score -= 25;
  if ((risk?.openPositions ?? 0) >= policy.maxOpenPositionsPerAgent) score -= 14;
  if (status === "blocked") score -= 18;
  if (status === "needs_approval") score -= 6;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function statusForEvaluation(evaluation: AgentPolicyEvaluation): AgentScoutStatus {
  if (evaluation.decision === "allowed") return "ready";
  if (evaluation.decision === "requires_human_approval") return "needs_approval";
  return "blocked";
}

function proposalStatusForEvaluation(
  evaluation: AgentPolicyEvaluation,
): AgentProposalStatus {
  if (evaluation.decision === "allowed") return "approved";
  if (evaluation.decision === "requires_human_approval") return "needs_approval";
  return "blocked";
}

function technicalRead({
  market,
  side,
  snapshot,
}: {
  market: string;
  side: TradeSide;
  snapshot: AgentMarketDataSnapshot | null;
}): string {
  if (!snapshot) {
    return `${market} is on the watchlist, but this scout pass did not receive fresh market data.`;
  }
  const funding = snapshot.fundingRatePct == null ? "unknown funding" : `${snapshot.fundingRatePct}% funding`;
  return `${market} mark is ${formatUsd(snapshot.markPriceUsd)} with ${funding}; scout bias is ${side}.`;
}

function riskRead({
  draft,
  policy,
  session,
}: {
  draft: AgentTradeProposal;
  policy: AgentVaultPolicy;
  session?: AgentSessionGrant | null;
}): string {
  const limit = minPositive([policy.maxNotionalUsd, session?.maxNotionalUsd], 0);
  return `Use ${formatUsd(draft.notionalUsd)} notional inside the ${formatUsd(limit)} allowance, ${draft.leverage}x leverage, stop ${draft.stopLossPrice}, target ${draft.takeProfitPrice}.`;
}

function exitRead({ draft }: { draft: AgentTradeProposal }): string {
  return `Exit at target ${draft.takeProfitPrice}, stop ${draft.stopLossPrice}, or when the scout thesis no longer matches the market.`;
}

function invalidationRead({ draft }: { draft: AgentTradeProposal }): string {
  return `Invalid if ${draft.market} trades through ${draft.stopLossPrice} or ClearSig risk checks stop the idea.`;
}

function policyRead(evaluation: AgentPolicyEvaluation): string {
  if (evaluation.decision === "allowed") return "ClearSig would allow this idea under the active rules.";
  const first = evaluation.violations[0]?.message;
  if (evaluation.decision === "requires_human_approval") {
    return first ? `ClearSig needs approval: ${first}` : "ClearSig needs approval before this can trade.";
  }
  return first ? `ClearSig blocks this idea: ${first}` : "ClearSig blocks this idea under the active rules.";
}

function nextActionFor(status: AgentScoutStatus): string {
  if (status === "ready") return "Prepare the idea and let ClearSig open the paper trade.";
  if (status === "needs_approval") return "Prepare the idea for owner approval.";
  if (status === "blocked") return "Fix the safety rule, allowance, or trader setup before using this.";
  return "Keep watching until enough evidence appears.";
}

function headlineFor({
  agent,
  market,
  side,
  status,
  score,
}: {
  agent: AgentProfile;
  market: string;
  side: TradeSide;
  status: AgentScoutStatus;
  score: number;
}): string {
  const action = status === "ready" ? "can prepare" : status === "blocked" ? "is watching" : "found";
  return `${agent.name} ${action} a ${market} ${side} setup (${score}/100).`;
}

function thesisFor({
  agent,
  market,
  side,
  snapshot,
}: {
  agent: AgentProfile;
  market: string;
  side: TradeSide;
  snapshot: AgentMarketDataSnapshot | null;
}): string {
  const source = snapshot
    ? `${snapshot.source === "live" ? "live" : "practice"} market data at ${formatUsd(snapshot.markPriceUsd)}`
    : "the agent watchlist";
  return `${agent.name} scouted ${market} using ${source} and prepared a ${side} thesis for ClearSig to risk-check.`;
}

function positiveNumber(value: string | number | null | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function minPositive(values: Array<string | number | null | undefined>, fallback: number): number {
  const positives = values
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  return positives.length > 0 ? Math.min(...positives) : fallback;
}

function referencePrice(market: string): number {
  if (market === "ETH-PERP") return 3850;
  if (market === "SOL-PERP") return 172;
  return 67500;
}

function normalizeMarket(value: string): string {
  return value.trim().toUpperCase();
}

function formatMoney(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function formatPrice(value: number): string {
  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
