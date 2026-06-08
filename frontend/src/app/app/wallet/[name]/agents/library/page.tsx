"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CircleDollarSign,
  Plug,
  ShieldCheck,
  Sparkles,
  Trophy,
  TrendingUp,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import {
  agentLeaderboard,
  agentLibraryMetrics,
  AGENT_TRACK_RECORD_SOURCES,
  buildAgentTrackRecordBook,
  estimateAgentOpenTradePerformance,
  executionTrackRecordSource,
  getAgentVaultPolicy,
  isAgentSessionCurrent,
  listAgentExecutions,
  listAgentProposals,
  listAgentScorecards,
  listAgentSessions,
  CLEARSIG_TRADER_LIBRARY,
  createClearSigLibraryTrader,
  encryptAgentProfile,
  listAgents,
  newAgentId,
  proposalTrackRecordSource,
  recommendAgentAllocation,
  saveAgent,
  seedClearSigAgentDemoHistory,
  syncAgentProfile,
  type AgentAllocationRecommendation,
  type AgentExecutionRecord,
  type AgentLibraryMetrics,
  type AgentLeaderboardEntry,
  type AgentMarketDataSnapshot,
  type AgentProfile,
  type AgentTrackRecordBook,
  type AgentTrackRecordSource,
  type AgentTradeProposal,
  type AgentScorecard,
  type AgentSessionGrant,
  type TradingVenue,
  type ClearSigTraderRisk,
  type ClearSigTraderTemplate,
} from "@/lib/agents";
import { loadAgentMarketDataSnapshots } from "@/lib/agents/clientMarketData";
import { toDisplayName } from "@/lib/retail/walletNames";

type LibraryWindow = "7d" | "30d" | "all";
type TrackedAgentItem = {
  agent: AgentProfile;
  scorecard?: AgentScorecard;
  leaderboard?: AgentLeaderboardEntry;
  rank: number;
  allocation: AgentAllocationRecommendation;
  currentSession?: AgentSessionGrant;
  metrics: AgentLibraryMetrics;
  executions: AgentExecutionRecord[];
  stoppedProposals: AgentTradeProposal[];
};

export default function TraderLibraryPage() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [window, setWindow] = useState<LibraryWindow>("7d");
  const [market, setMarket] = useState("all");
  const [trackSource, setTrackSource] = useState<AgentTrackRecordSource>("paper");
  const [marketByMarket, setMarketByMarket] = useState<Record<string, AgentMarketDataSnapshot>>({});
  const [, setRefreshKey] = useState(0);
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const chosen = listAgents(name).filter((agent) => agent.status !== "revoked");
  const scorecards = listAgentScorecards(name);
  const leaderboard = agentLeaderboard(name);
  const policy = getAgentVaultPolicy(name);
  const sessions = listAgentSessions(name);
  const executions = listAgentExecutions(name);
  const proposals = listAgentProposals(name);
  const trackRecordBook = useMemo(
    () =>
      buildAgentTrackRecordBook({
        agents: chosen,
        proposals,
        executions,
      }),
    [chosen, executions, proposals],
  );
  const selectedLane =
    trackRecordBook.lanes.find((lane) => lane.source === trackSource) ??
    trackRecordBook.lanes.find((lane) => lane.source === trackRecordBook.primarySource) ??
    trackRecordBook.lanes[0];
  const selectedScorecards = selectedLane?.scorecards ?? scorecards;
  const selectedLeaderboard = selectedLane?.leaderboard ?? leaderboard;
  const openMarketKey = executions
    .filter((execution) => execution.status === "open")
    .map((execution) => execution.market.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join("|");

  useEffect(() => {
    const markets = openMarketKey ? openMarketKey.split("|") : [];
    if (markets.length === 0) {
      setMarketByMarket({});
      return;
    }
    let cancelled = false;
    void loadAgentMarketDataSnapshots(markets).then((snapshots) => {
      if (!cancelled) setMarketByMarket(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [openMarketKey]);

  const trackedAgents: TrackedAgentItem[] = chosen
    .map((agent) => {
      const scorecard = scorecards.find((item) => item.agentId === agent.id);
      const sourceScorecard =
        selectedScorecards.find((item) => item.agentId === agent.id) ?? scorecard;
      const rank = selectedLeaderboard.findIndex((item) => item.agentId === agent.id) + 1;
      const leader = selectedLeaderboard.find((item) => item.agentId === agent.id);
      const currentSession = sessions.find((session) =>
        isAgentSessionCurrent(session, policy) && session.agentId === agent.id,
      );
      const allocation = recommendAgentAllocation({
        agent,
        scorecard: sourceScorecard,
        leaderboard: leader,
        currentSession,
        policy,
      });
      const agentExecutions = executions.filter(
        (execution) =>
          execution.agentId === agent.id &&
          executionTrackRecordSource(execution) === trackSource,
      );
      const metrics = agentLibraryMetrics({
        agent,
        scorecard: sourceScorecard,
        executions: agentExecutions,
      });
      const stoppedProposals = proposals.filter(
        (proposal) =>
          proposal.agentId === agent.id &&
          proposal.status === "blocked" &&
          proposalTrackRecordSource(proposal) === trackSource,
      );
      return {
        agent,
        scorecard: sourceScorecard,
        leaderboard: leader,
        rank,
        allocation,
        currentSession,
        metrics,
        executions: agentExecutions,
        stoppedProposals,
      };
    })
    .sort((a, b) => librarySort(a, b));
  const marketOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...CLEARSIG_TRADER_LIBRARY.flatMap((trader) => trader.markets),
          ...trackedAgents.flatMap((item) => agentMarkets(item.agent, executions)),
        ]),
      ).sort(),
    [executions, trackedAgents],
  );
  const filteredTrackedAgents = trackedAgents.filter((item) =>
    market === "all" ? true : agentMarkets(item.agent, executions).includes(market),
  );
  const filteredTemplates = CLEARSIG_TRADER_LIBRARY.filter((trader) =>
    market === "all" ? true : trader.markets.includes(market),
  );

  const chooseTrader = (template: ClearSigTraderTemplate) => {
    startTransition(async () => {
      const existing = chosen.find(
        (agent) => agent.libraryTraderId === template.id && agent.status !== "revoked",
      );
      if (existing) {
        const currentSession = sessions.find(
          (session) =>
            session.agentId === existing.id &&
            isAgentSessionCurrent(session, policy) &&
            sessionAllowsVenue(session, "mock_perps", policy),
        );
        toast.info(`${template.name} is already in your traders`);
        router.push(
          currentSession
            ? `/app/wallet/${encoded}/agents/start?agent=${encodeURIComponent(existing.id)}&venue=mock_perps`
            : `/app/wallet/${encoded}/agents/sessions/new?agent=${encodeURIComponent(existing.id)}&venue=mock_perps&amount=${encodeURIComponent(template.defaultNotionalUsd)}&leverage=${template.defaultLeverage}`,
        );
        return;
      }

      try {
        const profile = createClearSigLibraryTrader({
          template,
          walletName: name,
          id: newAgentId(),
        });
        const encrypted = await encryptAgentProfile(profile);
        saveAgent(encrypted);
        const synced = await syncAgentProfile(encrypted);
        if (synced.ok) {
          toast.success(`${template.name} is ready for an allowance`);
        } else {
          toast.info(`${template.name} is ready on this device`, {
            details: synced.message,
          });
        }
        router.push(
          `/app/wallet/${encoded}/agents/sessions/new?agent=${encodeURIComponent(profile.id)}&venue=mock_perps&amount=${encodeURIComponent(template.defaultNotionalUsd)}&leverage=${template.defaultLeverage}`,
        );
      } catch (error) {
        toast.error("Could not choose this trader", {
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const addDemoHistory = () => {
    startTransition(() => {
      const result = seedClearSigAgentDemoHistory({ walletName: name });
      setRefreshKey((value) => value + 1);
      toast.success("Demo practice history added", {
        details: `${result.tradesCreated} closed trades and ${result.stoppedIdeasCreated} stopped ideas are now visible for testing.`,
      });
    });
  };

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Automated Trading
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Agent Library · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Choose an agent
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              Compare track records, safety behavior, and suggested allowances
              before you let an agent trade.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`/app/wallet/${encoded}/agents/new`}
              className={SECONDARY_BUTTON}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Create your own
            </Link>
            <button
              type="button"
              disabled={pending}
              onClick={addDemoHistory}
              className={SECONDARY_BUTTON}
            >
              <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
              Add demo history
            </button>
            <Link
              href={`/app/wallet/${encoded}/agents/new?mode=advanced`}
              className={SECONDARY_BUTTON}
            >
              <Plug className="h-3.5 w-3.5" aria-hidden="true" />
              Connect outside agent
            </Link>
          </div>
        </div>
      </header>

      <section className="border-y border-border-soft py-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Promise
            Icon={ShieldCheck}
            title="Verified by ClearSig"
            text="Every idea is checked before it can move forward."
          />
          <Promise
            Icon={Trophy}
            title="Ranked by results"
            text="Scores improve only after real practice history."
          />
          <Promise
            Icon={CircleDollarSign}
            title="Allowance guided"
            text="Better history can earn more room, weak history gets less."
          />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              Agents with track records
            </h2>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-soft">
              These are agents already added to this wallet. Their numbers come
              from trades and safety checks recorded in ClearSig.
            </p>
          </div>
          <LibraryFilters
            window={window}
            market={market}
            trackSource={trackSource}
            trackRecordBook={trackRecordBook}
            markets={marketOptions}
            trackedCount={filteredTrackedAgents.length}
            totalCount={trackedAgents.length}
            onWindowChange={setWindow}
            onMarketChange={setMarket}
            onTrackSourceChange={setTrackSource}
          />
        </div>
        {filteredTrackedAgents.length > 0 ? (
          <div className="grid gap-3 lg:grid-cols-2">
            {filteredTrackedAgents.map((item) => (
              <TrackedAgentCard
                key={item.agent.id}
                walletEncoded={encoded}
                agent={item.agent}
                scorecard={item.scorecard}
                leaderboard={item.leaderboard}
                rank={item.rank}
                allocation={item.allocation}
                currentSession={item.currentSession}
                metrics={item.metrics}
                executions={item.executions}
                marketByMarket={marketByMarket}
                stoppedProposals={item.stoppedProposals}
                window={window}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-5">
            <p className="text-sm font-semibold text-text-strong">
              No agent has a track record here yet
            </p>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-soft">
              {trackedAgents.length > 0
                ? "No tracked agent matches this market yet. Choose another market or start a prepared agent below."
                : "Start with a prepared agent below. After it places and closes practice trades, this area will show its score, profit/loss, recent profit/loss, win rate, open trades, safety stops, and allowance recommendation."}
            </p>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-strong">
            Prepared agents
          </h2>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-soft">
            These make the first run easy. They start as new agents and earn a
            score only after trading in this wallet.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-3">
        {filteredTemplates.map((trader) => {
          const existing = chosen.some(
            (agent) => agent.libraryTraderId === trader.id && agent.status !== "revoked",
          );
          const existingAgent = chosen.find(
            (agent) => agent.libraryTraderId === trader.id && agent.status !== "revoked",
          );
          const hasAllowance = existingAgent
            ? sessions.some(
                (session) =>
                  session.agentId === existingAgent.id &&
                  isAgentSessionCurrent(session, policy) &&
                  sessionAllowsVenue(session, "mock_perps", policy),
              )
            : false;
          return (
            <TraderCard
              key={trader.id}
              trader={trader}
              existing={existing}
              hasAllowance={hasAllowance}
              pending={pending}
              onChoose={() => chooseTrader(trader)}
            />
          );
        })}
        </div>
        {filteredTemplates.length === 0 ? (
          <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-5 text-sm text-text-soft">
            No prepared agent focuses on this market yet.
          </div>
        ) : null}
      </section>

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
        <div className="flex items-start gap-3">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-text-strong">
              Performance is earned, not claimed
            </p>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              ClearSig only ranks an agent from recorded trades and safety
              checks. A new agent can be useful, but it starts with the smallest
              allowance until it builds a record.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}

function TraderCard({
  trader,
  existing,
  hasAllowance,
  pending,
  onChoose,
}: {
  trader: ClearSigTraderTemplate;
  existing: boolean;
  hasAllowance: boolean;
  pending: boolean;
  onChoose: () => void;
}) {
  return (
    <article className="flex min-h-[25rem] flex-col rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Bot className="h-4 w-4" aria-hidden="true" />
        </span>
        <span
          className={clsx(
            "rounded-full border px-2 py-1 text-[10px] font-medium",
            riskTone(trader.risk),
          )}
        >
          {riskLabel(trader.risk)}
        </span>
      </div>
      <p className="mt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
        {trader.category}
      </p>
      <h2 className="mt-1 text-base font-semibold text-text-strong">{trader.name}</h2>
      <p className="mt-2 text-sm leading-relaxed text-text-soft">{trader.description}</p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <MetricBox label="Score" value="New" muted />
        <MetricBox label="Profit/loss" value="$0" muted />
        <MetricBox label="Trades" value="0" muted />
        <MetricBox label="Safety stops" value="0" muted />
      </div>

      <dl className="mt-4 grid gap-2 border-t border-border-soft pt-4">
        <LibraryStat label="Built for" value={trader.bestFor} />
        <LibraryStat label="Markets" value={trader.markets.join(", ")} />
        <LibraryStat
          label="First allowance"
          value={`Up to $${Number(trader.defaultNotionalUsd).toLocaleString("en-US")}`}
        />
        <LibraryStat label="Track record" value="Starts after first closed trade" />
      </dl>

      <button
        type="button"
        disabled={pending}
        onClick={onChoose}
        className="mt-auto inline-flex min-h-10 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
      >
        {hasAllowance ? "Start trading" : existing ? "Review allowance" : "Choose agent"}
        <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </article>
  );
}

function LibraryFilters({
  window,
  market,
  trackSource,
  trackRecordBook,
  markets,
  trackedCount,
  totalCount,
  onWindowChange,
  onMarketChange,
  onTrackSourceChange,
}: {
  window: LibraryWindow;
  market: string;
  trackSource: AgentTrackRecordSource;
  trackRecordBook: AgentTrackRecordBook;
  markets: string[];
  trackedCount: number;
  totalCount: number;
  onWindowChange: (window: LibraryWindow) => void;
  onMarketChange: (market: string) => void;
  onTrackSourceChange: (source: AgentTrackRecordSource) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-soft border border-border-soft bg-canvas p-1">
        {AGENT_TRACK_RECORD_SOURCES.map((source) => {
          const lane = trackRecordBook.lanes.find((item) => item.source === source);
          return (
            <button
              key={source}
              type="button"
              onClick={() => onTrackSourceChange(source)}
              className={clsx(
                "min-h-8 rounded-[6px] px-2.5 text-[11px] font-medium transition-colors",
                trackSource === source
                  ? "bg-surface-raised text-text-strong shadow-card-rest"
                  : "text-text-soft hover:text-text-strong",
              )}
            >
              {lane?.label ?? source}
            </button>
          );
        })}
      </div>
      <div className="inline-flex rounded-soft border border-border-soft bg-canvas p-1">
        {(["7d", "30d", "all"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onWindowChange(item)}
            className={clsx(
              "min-h-8 rounded-[6px] px-2.5 text-[11px] font-medium transition-colors",
              window === item
                ? "bg-surface-raised text-text-strong shadow-card-rest"
                : "text-text-soft hover:text-text-strong",
            )}
          >
            {item === "all" ? "All time" : item}
          </button>
        ))}
      </div>
      <select
        value={market}
        onChange={(event) => onMarketChange(event.target.value)}
        className="min-h-10 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
      >
        <option value="all">All markets</option>
        {markets.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </select>
      <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
        {trackedCount}/{totalCount} tracked
      </span>
      <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
        {trackRecordBook.lanes.find((lane) => lane.source === trackSource)?.tradeCount ?? 0}{" "}
        trades
      </span>
    </div>
  );
}

function TrackedAgentCard({
  walletEncoded,
  agent,
  scorecard,
  leaderboard,
  rank,
  allocation,
  currentSession,
  metrics,
  executions,
  marketByMarket,
  stoppedProposals,
  window,
}: {
  walletEncoded: string;
  agent: AgentProfile;
  scorecard?: AgentScorecard;
  leaderboard?: AgentLeaderboardEntry;
  rank: number;
  allocation: AgentAllocationRecommendation;
  currentSession?: AgentSessionGrant;
  metrics: AgentLibraryMetrics;
  executions: AgentExecutionRecord[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  stoppedProposals: AgentTradeProposal[];
  window: LibraryWindow;
}) {
  const hasCurrentAllowance = Boolean(currentSession);
  const currentVenue = currentSessionVenue(currentSession);
  const recentLabel = window === "all" ? "All-time P/L" : `${window} P/L`;
  const recentValue =
    window === "all"
      ? scorecard?.realizedPnlUsd ?? "0"
      : window === "30d"
        ? metrics.thirtyDayPnlUsd
        : metrics.sevenDayPnlUsd;
  const primaryHref = hasCurrentAllowance
    ? `/app/wallet/${walletEncoded}/agents/start?agent=${encodeURIComponent(agent.id)}&venue=${encodeURIComponent(currentVenue)}`
    : `/app/wallet/${walletEncoded}/agents/sessions/new?agent=${encodeURIComponent(agent.id)}&allocationTier=${allocation.tier.id}`;
  const primaryLabel = hasCurrentAllowance
    ? "Start trading"
    : allocation.action === "promote" ||
        allocation.action === "demote" ||
        allocation.action === "review"
      ? "Review allowance"
      : "Set allowance";
  const latestExecutions = [...executions]
    .sort((a, b) => (b.closedAt ?? b.openedAt) - (a.closedAt ?? a.openedAt))
    .slice(0, 4);
  const latestStops = [...stoppedProposals]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
  const published = agent.publishing?.status === "published";
  const moderationStatus = agent.publishing?.moderation?.status;
  return (
    <article className="flex flex-col rounded-card border border-border-soft bg-surface-raised p-5 shadow-card-rest">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-base font-semibold text-text-strong">
              {agent.name}
            </h3>
            <span className={clsx("rounded-full border px-2 py-1 text-[10px] font-medium", agentStatusTone(agent.status))}>
              {agent.status}
            </span>
            {published ? (
              <span
                className={clsx(
                  "rounded-full border px-2 py-1 text-[10px] font-medium",
                  moderationStatus === "approved"
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : moderationStatus === "delisted"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {moderationStatus === "approved"
                  ? "Approved"
                  : moderationStatus === "delisted"
                    ? "Delisted"
                    : moderationStatus === "paused"
                      ? "Paused"
                      : "Pending review"}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {agent.libraryTraderId ? "Prepared ClearSig agent" : "Custom agent"}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2 py-1 text-[11px] font-medium text-text-soft">
          <Trophy className="h-3 w-3" aria-hidden="true" />
          {rank > 0 ? `Rank #${rank}` : "Unranked"}
        </span>
      </div>

      {agent.description ? (
        <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-text-soft">
          {agent.description}
        </p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MetricBox label="Score" value={metrics.hasHistory ? String(leaderboard?.score ?? 50) : "New"} />
        <MetricBox label="Profit/loss" value={formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")} />
        <MetricBox label="Trades" value={String(metrics.closedTrades)} />
        <MetricBox label="Safety stops" value={String(scorecard?.ruleViolations ?? 0)} />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <MetricBox
          label={recentLabel}
          value={formatSignedUsd(recentValue)}
        />
        <MetricBox
          label="Win rate"
          value={metrics.winRatePct == null ? "New" : `${metrics.winRatePct}%`}
        />
        <MetricBox
          label="Open now"
          value={String(metrics.openTrades)}
        />
        <MetricBox
          label="Age"
          value={metrics.ageDays === 0 ? "Today" : `${metrics.ageDays}d`}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <MetricBox
          label="Largest fall"
          value={`${formatNumber(scorecard?.maxDrawdownPct ?? 0)}%`}
        />
        <MetricBox
          label="Human overrides"
          value={String(scorecard?.humanOverrideCount ?? 0)}
        />
      </div>

      <div className="mt-4 border-t border-border-soft pt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-text-strong">
              Allowance recommendation
            </p>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-soft">
              {allocation.summary}
            </p>
          </div>
          <span className={clsx("rounded-full border px-2 py-1 text-[10px] font-medium", allowanceTone(allocation.action))}>
            {allocation.action} · {allocation.tier.label}
          </span>
        </div>
        {allocation.nextTier && allocation.nextTierGaps.length > 0 ? (
          <p className="mt-2 text-[11px] leading-relaxed text-text-soft">
            To reach {allocation.nextTier.label}:{" "}
            {allocation.nextTierGaps.slice(0, 3).join(", ")}.
          </p>
        ) : null}
        <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
          <p className="text-[11px] font-semibold text-text-strong">
            Why this allowance level?
          </p>
          <ul className="mt-1 grid gap-1 text-[11px] leading-relaxed text-text-soft">
            {allocation.reasons.slice(0, 4).map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      </div>

      <details className="mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-3">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-xs font-semibold text-text-strong marker:hidden">
          <span className="inline-flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            Trade tape
          </span>
          <span className="text-[11px] font-medium text-text-soft">
            {latestExecutions.length} recent · {latestStops.length} stopped
          </span>
        </summary>
        <div className="mt-3 grid gap-2 border-t border-border-soft pt-3">
          {latestExecutions.length > 0 ? (
            latestExecutions.map((execution) => (
              <LibraryTradeRow
                key={execution.id}
                execution={execution}
                marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
              />
            ))
          ) : (
            <p className="rounded-soft border border-dashed border-border-soft bg-surface-raised px-3 py-2 text-xs text-text-soft">
              No trades recorded yet.
            </p>
          )}
          {latestStops.length > 0 ? (
            <div className="mt-1 grid gap-1.5">
              <p className="text-[11px] font-semibold text-text-strong">
                Stopped ideas
              </p>
              {latestStops.map((proposal) => (
                <LibraryStopRow key={proposal.id} proposal={proposal} />
              ))}
            </div>
          ) : null}
        </div>
      </details>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={primaryHref}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover"
        >
          {primaryLabel}
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <Link
          href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}`}
          className={SECONDARY_BUTTON}
        >
          View details
        </Link>
      </div>
    </article>
  );
}

function LibraryTradeRow({
  execution,
  marketSnapshot,
}: {
  execution: AgentExecutionRecord;
  marketSnapshot: AgentMarketDataSnapshot | null;
}) {
  const pnl = Number(execution.realizedPnlUsd || 0);
  const isOpen = execution.status === "open";
  const performance = estimateAgentOpenTradePerformance(execution, marketSnapshot);
  return (
    <div className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-text-strong">
            {execution.market} · {execution.side}
          </p>
          <p className="mt-0.5 text-[11px] text-text-soft">
            {formatUsd(execution.notionalUsd)} · {execution.leverage}x · {venueLabel(execution.venue)}
          </p>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2 py-1 text-[10px] font-medium",
            isOpen && performance
              ? Number(performance.unrealizedPnlUsd) > 0
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : Number(performance.unrealizedPnlUsd) < 0
                  ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                  : "border-border-soft text-text-soft"
              : isOpen
                ? "border-warning/30 bg-warning/[0.08] text-warning"
              : pnl > 0
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : pnl < 0
                  ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                  : "border-border-soft text-text-soft",
          )}
        >
          {isOpen
            ? performance
              ? formatSignedUsd(performance.unrealizedPnlUsd)
              : "Open"
            : formatSignedUsd(execution.realizedPnlUsd)}
        </span>
      </div>
      {isOpen ? (
        <p className="mt-1 text-[11px] text-text-soft">
          Entry {formatUsd(execution.entryPrice ?? "0")} · Mark{" "}
          {performance ? formatUsd(performance.markPriceUsd) : "waiting"}
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-text-muted">
        {isOpen ? "Opened" : "Closed"}{" "}
        {new Date((execution.closedAt ?? execution.openedAt)).toLocaleString()}
      </p>
    </div>
  );
}

function LibraryStopRow({ proposal }: { proposal: AgentTradeProposal }) {
  return (
    <div className="rounded-soft border border-warning/25 bg-warning/[0.06] px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="break-words text-xs font-semibold text-text-strong">
          {proposal.market} · {proposal.side}
        </p>
        <span className="rounded-full border border-warning/30 px-2 py-1 text-[10px] font-medium text-warning">
          Stopped
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-text-soft">
        {proposal.policyViolations?.[0]?.message ?? "Stopped by safety rules."}
      </p>
    </div>
  );
}

function Promise({
  Icon,
  title,
  text,
}: {
  Icon: typeof Check;
  title: string;
  text: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div>
        <p className="text-xs font-semibold text-text-strong">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-text-soft">{text}</p>
      </div>
    </div>
  );
}

function LibraryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </dt>
      <dd className="mt-0.5 text-xs leading-relaxed text-text-strong">{value}</dd>
    </div>
  );
}

function MetricBox({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-2.5 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className={clsx("mt-0.5 truncate text-xs font-semibold", muted ? "text-text-soft" : "text-text-strong")}>
        {value}
      </p>
    </div>
  );
}

function riskLabel(risk: ClearSigTraderRisk): string {
  switch (risk) {
    case "cautious":
      return "Cautious";
    case "balanced":
      return "Balanced";
    case "active":
      return "Active";
  }
}

function riskTone(risk: ClearSigTraderRisk): string {
  switch (risk) {
    case "cautious":
      return "border-accent/30 bg-accent/[0.08] text-accent";
    case "balanced":
      return "border-warning/30 bg-warning/[0.08] text-warning";
    case "active":
      return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
  }
}

function librarySort(
  a: {
    agent: AgentProfile;
    scorecard?: AgentScorecard;
    leaderboard?: AgentLeaderboardEntry;
  },
  b: {
    agent: AgentProfile;
    scorecard?: AgentScorecard;
    leaderboard?: AgentLeaderboardEntry;
  },
): number {
  const activeDelta = statusWeight(b.agent.status) - statusWeight(a.agent.status);
  if (activeDelta !== 0) return activeDelta;
  const scoreDelta = (b.leaderboard?.score ?? 50) - (a.leaderboard?.score ?? 50);
  if (scoreDelta !== 0) return scoreDelta;
  const tradesDelta = (b.scorecard?.executed ?? 0) - (a.scorecard?.executed ?? 0);
  if (tradesDelta !== 0) return tradesDelta;
  return a.agent.name.localeCompare(b.agent.name);
}

function statusWeight(status: AgentProfile["status"]): number {
  if (status === "active") return 3;
  if (status === "paused") return 2;
  return 1;
}

function agentMarkets(
  agent: AgentProfile,
  executions: Array<{ agentId: string; market: string }>,
): string[] {
  const values = [
    ...(agent.strategy?.allowedMarkets ?? []),
    ...executions
      .filter((execution) => execution.agentId === agent.id)
      .map((execution) => execution.market),
  ];
  return Array.from(new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean)));
}

function agentStatusTone(status: AgentProfile["status"]): string {
  if (status === "active") return "border-accent/30 bg-accent/[0.08] text-accent";
  if (status === "paused") return "border-warning/30 bg-warning/[0.08] text-warning";
  return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
}

function allowanceTone(action: AgentAllocationRecommendation["action"]): string {
  if (action === "promote") return "border-accent/30 bg-accent/[0.08] text-accent";
  if (action === "demote") return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
  if (action === "review") return "border-warning/30 bg-warning/[0.08] text-warning";
  return "border-border-soft bg-canvas text-text-soft";
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) ? parsed : 0;
  const abs = Math.abs(safe).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  if (safe > 0) return `+$${abs}`;
  if (safe < 0) return `-$${abs}`;
  return "$0";
}

function formatUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function venueLabel(venue: TradingVenue): string {
  switch (venue) {
    case "mock_perps":
      return "Built-in practice";
    case "hyperliquid_testnet":
      return "Hyperliquid practice";
    case "bulktrade_mock":
      return "Bulk practice";
  }
}

function sessionAllowsVenue(
  session: AgentSessionGrant,
  venue: TradingVenue,
  policy: { allowedVenues: TradingVenue[] },
): boolean {
  return session.allowedVenues?.length
    ? session.allowedVenues.includes(venue)
    : policy.allowedVenues.includes(venue);
}

function currentSessionVenue(session: AgentSessionGrant | undefined): TradingVenue {
  return session?.allowedVenues?.[0] ?? "mock_perps";
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

const SECONDARY_BUTTON =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent";
