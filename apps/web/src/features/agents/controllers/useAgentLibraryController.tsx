"use client";

import { useToast } from "@/components/ui/Toast";
import {
  decodeRouteParam as decodeParam
} from "@/features/agents/domain";
import { agentMarkets, librarySort, sessionAllowsVenue } from "@/features/agents/domain/library";
import { type AgentAllocationRecommendation, type AgentExecutionRecord, type AgentLeaderboardEntry, agentLibraryMetrics, type AgentLibraryMetrics, type AgentMarketDataSnapshot, type AgentProfile, type AgentScorecard, type AgentSessionGrant, type AgentTrackRecordSource, type AgentTradeProposal, buildAgentTrackRecordBook, CLEARSIG_TRADER_LIBRARY, type ClearSigTraderTemplate, createClearSigLibraryTrader, executionTrackRecordSource, isAgentSessionCurrent, proposalTrackRecordSource, recommendAgentAllocation } from "@/features/agents/domain/runtime";
import { syncAgentProfile } from "@/features/agents/infrastructure/stateClient";
import { agentLeaderboard, getAgentVaultPolicy, listAgentExecutions, listAgentProposals, listAgents, listAgentScorecards, listAgentSessions, newAgentId, saveAgent } from "@/features/agents/infrastructure/agentStore";
import { loadAgentMarketDataSnapshots } from "@/features/agents/infrastructure/marketDataClient";
import { encryptAgentProfile } from "@/features/agents/infrastructure/vaultCrypto";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

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

export function useAgentLibraryController() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
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
  const showDeveloperSurfaces = search.get("debug") === "1";
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
          toast.success(`${template.name} is ready for a practice budget`);
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
    startTransition(async () => {
      const { seedClearSigAgentDemoHistory } = await import(
        "@/features/agents/infrastructure/demoClient"
      );
      const result = seedClearSigAgentDemoHistory({ walletName: name });
      setRefreshKey((value) => value + 1);
      toast.success("Demo practice history added", {
        details: `${result.tradesCreated} closed trades and ${result.stoppedIdeasCreated} stopped ideas are now visible for testing.`,
      });
    });
  };
  return {
    addDemoHistory,
    chooseTrader,
    chosen,
    display,
    encoded,
    filteredTemplates,
    filteredTrackedAgents,
    market,
    marketByMarket,
    marketOptions,
    pending,
    policy,
    sessions,
    setMarket,
    setTrackSource,
    setWindow,
    showDeveloperSurfaces,
    trackRecordBook,
    trackedAgents,
    trackSource,
    window,
  };
}
