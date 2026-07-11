"use client";

import { useToast } from "@/components/ui/Toast";
import { useAgentDashboardActions } from "@/features/agents/controllers/useAgentDashboardActions";
import { type AgentAllocationRecommendation, type AgentAuditEvent, type AgentBetaReadiness, type AgentExecutionRecord, type AgentLeaderboardEntry, type AgentMarketDataSnapshot, type AgentMarketIntelligenceSnapshot, type AgentMarketReadiness, type AgentProfile, type AgentScorecard, type AgentScoutReport, type AgentSessionGrant, type AgentTradeProposal, type AgentTradingReadiness, type AgentVaultPolicy, buildAgentAutomaticExitDecisions, buildAgentBetaReadiness, buildAgentMarketReadiness, buildAgentScoutReports, buildAgentTradingReadiness, hasAgentComplianceAcknowledgement, isAgentSessionCurrent, recommendAgentAllocation } from "@/features/agents/domain/runtime";
import { type AgentInboxSummary, loadAgentInboxSummary } from "@/features/agents/infrastructure/inboxClient";
import { type AgentKillSwitchHandoff, loadAgentBackendState } from "@/features/agents/infrastructure/stateClient";
import { type AgentVenueReadiness, loadAgentVenueReadinessForAgents, startAgentVenueReadinessPolling } from "@/features/agents/infrastructure/executionClient";
import { agentLeaderboard, agentRiskSnapshot, getAgentVaultPolicy, listAgentConnectionKits, listAgentEvents, listAgentExecutions, listAgentOwnerApprovals, listAgentProposals, listAgents, listAgentScorecards, listAgentSessions, subscribeAgents } from "@/features/agents/infrastructure/agentStore";
import { getAgentHyperliquidSetupSettings } from "@/features/agents/infrastructure/hyperliquidSettings";
import { loadAgentMarketDataSnapshots, loadAgentMarketIntelligenceSnapshots } from "@/features/agents/infrastructure/marketDataClient";
import { buildAgentNotifications, markAgentNotificationSeen, markAllAgentNotificationsSeen, readSeenAgentNotificationIds, subscribeAgentNotifications } from "@/features/agents/infrastructure/notificationStore";
import { useAgentTypedClearSignApproval } from "@/features/agents/infrastructure/typedApprovalClient";
import { encryptStatus } from "@/lib/encrypt/client";
import { toDisplayName } from "@/lib/retail/walletNames";
import { useReducedMotion } from "framer-motion";
import { Bot, Clock, type LucideIcon, Play, ShieldCheck } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";

type BackendPersistenceStatus = {
  state: "checking" | "synced" | "local";
  storage?: "redis" | "memory";
  agents: number;
  proposals: number;
  sessions: number;
  events: number;
  message: string;
  updatedAt?: number;
};
type GettingStartedStep = {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  done: boolean;
  href: string;
  actionLabel: string;
};

export function useAgentDashboardController() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const reduce = useReducedMotion();
  const toast = useToast();
  const [pendingAction, startAction] = useTransition();
  const name = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const encrypt = encryptStatus();
  const showDeveloperSurfaces = search.get("debug") === "1";
  const approveTypedAgentClearSign = useAgentTypedClearSignApproval(name);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [policy, setPolicy] = useState<AgentVaultPolicy | null>(null);
  const [leaderboard, setLeaderboard] = useState<AgentLeaderboardEntry[]>([]);
  const [proposals, setProposals] = useState<AgentTradeProposal[]>([]);
  const [sessions, setSessions] = useState<AgentSessionGrant[]>([]);
  const [executions, setExecutions] = useState<AgentExecutionRecord[]>([]);
  const [events, setEvents] = useState<AgentAuditEvent[]>([]);
  const [scorecards, setScorecards] = useState<AgentScorecard[]>([]);
  const [proposalCount, setProposalCount] = useState(0);
  const [inboxSummaries, setInboxSummaries] = useState<Record<string, AgentInboxSummary>>({});
  const [marketByMarket, setMarketByMarket] = useState<Record<string, AgentMarketDataSnapshot>>({});
  const [intelligenceByMarket, setIntelligenceByMarket] = useState<Record<string, AgentMarketIntelligenceSnapshot>>({});
  const [seenAgentNotifications, setSeenAgentNotifications] = useState<Set<string>>(
    () => new Set(),
  );
  const [liveVenueReadiness, setLiveVenueReadiness] =
    useState<AgentVenueReadiness | null>(null);
  const [liveVenueLoading, setLiveVenueLoading] = useState(true);
  const [killSwitchHandoff, setKillSwitchHandoff] =
    useState<AgentKillSwitchHandoff | null>(null);
  const [backendStatus, setBackendStatus] = useState<BackendPersistenceStatus>({
    state: "checking",
    agents: 0,
    proposals: 0,
    sessions: 0,
    events: 0,
    message: "Checking saved changes.",
  });
  useEffect(() => {
    const refresh = () => {
      setAgents(listAgents(name));
      setPolicy(getAgentVaultPolicy(name));
      setLeaderboard(agentLeaderboard(name));
      const nextProposals = listAgentProposals(name);
      const nextSessions = listAgentSessions(name);
      setProposals(nextProposals);
      setSessions(nextSessions);
      setExecutions(listAgentExecutions(name));
      setEvents(listAgentEvents(name));
      setScorecards(listAgentScorecards(name));
      setProposalCount(nextProposals.length);
    };
    refresh();
    return subscribeAgents(refresh);
  }, [name]);
  const refreshBackendState = useCallback(async () => {
    setBackendStatus((current) => ({ ...current, state: "checking" }));
    const result = await loadAgentBackendState(name);
    if (!result.ok || !result.value) {
      setBackendStatus({
        state: "local",
        agents: 0,
        proposals: 0,
        sessions: 0,
        events: 0,
        message: result.message,
      });
      return;
    }
    const state = result.value.state;
    setBackendStatus({
      state: "synced",
      storage: result.value.storage,
      agents: state.agents.length,
      proposals: state.proposals.length,
      sessions: state.sessions.length,
      events: state.events.length,
      message:
        result.value.storage === "redis"
          ? "Backend persistence is using Redis."
          : "Backend persistence is using local memory.",
      updatedAt: state.updatedAt,
    });
  }, [name]);
  useEffect(() => {
    if (!showDeveloperSurfaces) return;
    void refreshBackendState();
  }, [refreshBackendState, showDeveloperSurfaces]);
  useEffect(() => {
    const refresh = () => setSeenAgentNotifications(readSeenAgentNotificationIds(name));
    refresh();
    return subscribeAgentNotifications(refresh);
  }, [name]);
  useEffect(() => {
    if (agents.length === 0) {
      setInboxSummaries({});
      return;
    }
    let cancelled = false;
    const run = async () => {
      const pairs = await Promise.all(
        agents.map(async (agent) => {
          try {
            return [agent.id, await loadAgentInboxSummary(name, agent.id)] as const;
          } catch {
            return [
              agent.id,
              {
                count: 0,
                storage: "unknown",
                status: "unavailable",
                updatedAt: Date.now(),
              } satisfies AgentInboxSummary,
            ] as const;
          }
        }),
      );
      if (!cancelled) setInboxSummaries(Object.fromEntries(pairs));
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [agents, name]);
  const agentIds = useMemo(() => agents.map((agent) => agent.id).sort(), [agents]);
  useEffect(() => {
    setLiveVenueLoading(true);
    const setup = getAgentHyperliquidSetupSettings(name);
    return startAgentVenueReadinessPolling({
      venue: "hyperliquid_testnet",
      load: () =>
        loadAgentVenueReadinessForAgents("hyperliquid_testnet", {
          walletName: name,
          agentIds,
          accountAddress: setup.accountAddress,
        }),
      onUpdate: (readiness) => {
        setLiveVenueReadiness(readiness);
        setLiveVenueLoading(false);
      },
      onError: () => {
        setLiveVenueReadiness(null);
        setLiveVenueLoading(false);
      },
    });
  }, [agentIds, name]);
  const openExecutionRecords = useMemo(
    () => executions.filter((execution) => execution.status === "open"),
    [executions],
  );
  const watchedMarketKey = useMemo(
    () =>
      Array.from(
        new Set([
          ...openExecutionRecords.map((execution) => execution.market.trim().toUpperCase()),
          ...agents
            .filter((agent) => agent.status === "active")
            .flatMap((agent) => agent.strategy?.allowedMarkets ?? [])
            .map((market) => market.trim().toUpperCase()),
        ]),
      )
        .filter(Boolean)
        .sort()
        .slice(0, 8)
        .join("|"),
    [agents, openExecutionRecords],
  );
  useEffect(() => {
    const watchedMarkets = watchedMarketKey ? watchedMarketKey.split("|") : [];
    if (watchedMarkets.length === 0) {
      setMarketByMarket({});
      setIntelligenceByMarket({});
      return;
    }
    let cancelled = false;
    void loadAgentMarketDataSnapshots(watchedMarkets).then((snapshots) => {
      if (!cancelled) setMarketByMarket(snapshots);
    });
    if (showDeveloperSurfaces) {
      void loadAgentMarketIntelligenceSnapshots(watchedMarkets).then((snapshots) => {
        if (!cancelled) setIntelligenceByMarket(snapshots);
      });
    } else {
      setIntelligenceByMarket({});
    }
    return () => {
      cancelled = true;
    };
  }, [showDeveloperSurfaces, watchedMarketKey]);
  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const activeAgents = agents.filter((agent) => agent.status === "active").length;
  const activeSessions = policy
    ? sessions.filter((session) => isAgentSessionCurrent(session, policy)).length
    : 0;
  const openExecutions = openExecutionRecords.length;
  const queuedSignals = Object.values(inboxSummaries).reduce(
    (total, summary) => total + summary.count,
    0,
  );
  const readiness = useMemo<AgentTradingReadiness[]>(() => {
    if (!policy) return [];
    const now = Date.now();
    return agents.map((agent) =>
      buildAgentTradingReadiness({
        agent,
        policy,
        sessions: sessions.filter((session) => session.agentId === agent.id),
        risk: agentRiskSnapshot(name, agent.id),
        now,
      }),
    );
  }, [agents, name, policy, sessions]);
  const readyAgents = readiness.filter((item) => item.status === "ready").length;
  const canRunAutonomyScan =
    readyAgents > 0 && backendStatus.state === "synced";
  const scoutReports = useMemo<AgentScoutReport[]>(() => {
    if (!policy) return [];
    const now = Date.now();
    return buildAgentScoutReports({
      agents,
      policy,
      sessions,
      marketByMarket,
      intelligenceByMarket,
      risksByAgent: Object.fromEntries(
        agents.map((agent) => [agent.id, agentRiskSnapshot(name, agent.id)]),
      ),
      now,
    }).slice(0, 3);
  }, [agents, intelligenceByMarket, marketByMarket, name, policy, sessions]);
  const automaticExitDecisions = useMemo(
    () =>
      buildAgentAutomaticExitDecisions({
        executions: openExecutionRecords,
        proposals,
        marketByMarket,
      }),
    [marketByMarket, openExecutionRecords, proposals],
  );
  const agentNotificationSummary = useMemo(
    () =>
      buildAgentNotifications({
        walletName: name,
        walletHref: `/app/wallet/${encoded}`,
        agents,
        proposals,
        sessions,
        executions,
        events,
        policy,
      }),
    [agents, encoded, events, executions, name, policy, proposals, sessions],
  );
  const unreadAgentNotifications = agentNotificationSummary.notifications.filter(
    (notification) => !seenAgentNotifications.has(notification.id),
  );
  const markAgentNoticeSeen = useCallback(
    (id: string) => {
      markAgentNotificationSeen(name, id);
      setSeenAgentNotifications(readSeenAgentNotificationIds(name));
    },
    [name],
  );
  const markAllAgentNoticesSeen = useCallback(() => {
    markAllAgentNotificationsSeen(
      name,
      agentNotificationSummary.notifications.map((notification) => notification.id),
    );
    setSeenAgentNotifications(readSeenAgentNotificationIds(name));
  }, [agentNotificationSummary.notifications, name]);
  const gettingStartedSteps = useMemo<GettingStartedStep[]>(() => {
    const firstAgent = agents[0];
    const firstReadiness = firstAgent
      ? readiness.find((item) => item.agentId === firstAgent.id)
      : undefined;
    const itemPassed = (id: string) =>
      firstReadiness?.items.find((item) => item.id === id)?.status === "pass";
    const hasFirstPractice = executions.length > 0;

    return [
      {
        id: "trader",
        label: "Choose trader",
        description: "Pick the prepared trader you want to try.",
        Icon: Bot,
        done: Boolean(firstAgent),
        href: `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Choose trader",
      },
      {
        id: "allowance",
        label: "Set budget",
        description: "Give the trader a small practice budget.",
        Icon: Clock,
        done: itemPassed("session"),
        href: firstAgent
          ? `/app/wallet/${encoded}/agents/sessions/new?agent=${encodeURIComponent(firstAgent.id)}`
          : `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Set budget",
      },
      {
        id: "safety",
        label: "Set safety",
        description: "Choose max size, max loss, and stop conditions.",
        Icon: ShieldCheck,
        done: itemPassed("risk-limits"),
        href: `/app/wallet/${encoded}/agents/policy`,
        actionLabel: "Set safety",
      },
      {
        id: "practice",
        label: "Start practice",
        description: "Run the first practice trade. Pause anytime.",
        Icon: Play,
        done: hasFirstPractice,
        href: firstAgent
          ? `/app/wallet/${encoded}/agents/start?agent=${encodeURIComponent(firstAgent.id)}`
          : `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Start practice",
      },
    ];
  }, [agents, encoded, executions.length, readiness]);
  const setupComplete = gettingStartedSteps.every((step) => step.done);
  const allocationRecommendations = useMemo(() => {
    if (!policy) return {} as Record<string, AgentAllocationRecommendation>;
    const now = Date.now();
    return Object.fromEntries(
      agents.map((agent) => [
        agent.id,
        recommendAgentAllocation({
          agent,
          scorecard: scorecards.find((item) => item.agentId === agent.id),
          leaderboard: leaderboard.find((item) => item.agentId === agent.id),
          currentSession: sessions.find(
            (session) =>
              session.agentId === agent.id &&
              isAgentSessionCurrent(session, policy, now),
          ),
          policy,
          now,
        }),
      ]),
    );
  }, [agents, leaderboard, policy, scorecards, sessions]);
  const betaReadiness = useMemo<AgentBetaReadiness | null>(() => {
    if (!policy) return null;
    const openMarkets = Array.from(
      new Set(
        openExecutionRecords
          .map((execution) => execution.market.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    const connected =
      liveVenueReadiness?.state === "ready" &&
      liveVenueReadiness.executorProbe?.state === "ready" &&
      liveVenueReadiness.accountProbe?.state === "funded";
    return buildAgentBetaReadiness({
      agents,
      policy,
      sessions,
      executions,
      proposals,
      approvals: listAgentOwnerApprovals(name),
      connections: listAgentConnectionKits(name),
      backend: {
        state: backendStatus.state,
        storage: backendStatus.storage,
      },
      marketData: {
        openMarkets: openMarkets.length,
        pricedOpenMarkets: openMarkets.filter((market) => marketByMarket[market]).length,
      },
      venue: {
        state: liveVenueLoading
          ? "checking"
          : connected
            ? "connected"
            : liveVenueReadiness
              ? "needs_setup"
              : "unavailable",
      },
      walletHref: `/app/wallet/${encoded}`,
    });
  }, [
    agents,
    backendStatus.state,
    backendStatus.storage,
    encoded,
    executions,
    liveVenueLoading,
    liveVenueReadiness,
    marketByMarket,
    name,
    openExecutionRecords,
    policy,
    proposals,
    sessions,
  ]);
  const marketReadiness = useMemo<AgentMarketReadiness | null>(() => {
    if (!policy) return null;
    const openMarkets = Array.from(
      new Set(
        openExecutionRecords
          .map((execution) => execution.market.trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    const connected =
      liveVenueReadiness?.state === "ready" &&
      liveVenueReadiness.executorProbe?.state === "ready" &&
      liveVenueReadiness.accountProbe?.state === "funded";
    const snapshots = Object.values(marketByMarket);
    const intelligence = Object.values(intelligenceByMarket);
    const approvals = listAgentOwnerApprovals(name);
    const connections = listAgentConnectionKits(name);
    return buildAgentMarketReadiness({
      agents,
      policy,
      sessions,
      executions,
      proposals,
      approvals,
      connections,
      backend: {
        state: backendStatus.state,
        storage: backendStatus.storage,
      },
      marketData: {
        openMarkets: openMarkets.length,
        pricedOpenMarkets: openMarkets.filter((market) => marketByMarket[market]).length,
        liveMarkets: snapshots.filter((snapshot) => snapshot.source === "live").length,
        hasFundingRates: snapshots.some((snapshot) => snapshot.fundingRatePct != null),
      },
      venue: {
        state: liveVenueLoading
          ? "checking"
          : connected
            ? "connected"
            : liveVenueReadiness
              ? "needs_setup"
              : "unavailable",
      },
      operations: {
        walletSignedMutations: approvals.some(
          (approval) => approval.approvalMethod === "wallet_signature" && approval.signature,
        )
          ? "partial"
          : "none",
        creatorRegistry: agents.some((agent) => agent.publishing?.status === "published")
          ? "local_profiles"
          : "none",
        creatorPayouts: "not_started",
        externalVerification: connections.length > 0 ? "signed_decisions" : "none",
        marketIntelligence: {
          news: intelligence.some((snapshot) => snapshot.coverage.news),
          macro: intelligence.some((snapshot) => snapshot.coverage.macro),
          rateLimited: true,
        },
        leaderboardMode: "separated",
        compliance: hasAgentComplianceAcknowledgement(name, "mock_perps")
          ? "user_disclosures"
          : "draft",
        moderation: agents.some((agent) => agent.publishing?.status === "published")
          ? agents
            .filter((agent) => agent.publishing?.status === "published")
            .every((agent) => agent.publishing?.moderation)
            ? "active"
            : "admin_review"
          : "none",
        abuseControls: {
          sameOrigin: true,
          rateLimits: true,
          signalKeys: connections.length > 0,
          replayProtection: proposals.some((proposal) => Boolean(proposal.clientSignalId)),
          signedSignals: false,
        },
        venueReconciliation: connected ? "testnet_snapshots" : "requested",
      },
      walletHref: `/app/wallet/${encoded}`,
    });
  }, [
    agents,
    backendStatus.state,
    backendStatus.storage,
    encoded,
    executions,
    liveVenueLoading,
    liveVenueReadiness,
    intelligenceByMarket,
    marketByMarket,
    name,
    openExecutionRecords,
    policy,
    proposals,
    sessions,
  ]); const {
    prepareScoutIdea,
    runAutonomyScan,
    setKillSwitch,
    startBetaDemo,
    submitVenueProposal,
    approveProposal,
    rejectProposal,
    executeProposal,
    recheckProposal,
    closeExecution,
    closeAllOpenPaperTrades,
    closeAutomaticExitTrades,
    setAgentStatus,
    revokeSession,
    renewSession,
  } = useAgentDashboardActions({
    agents,
    approveTypedAgentClearSign,
    automaticExitDecisions,
    encoded,
    executions,
    name,
    openExecutionRecords,
    policy,
    proposals,
    refreshBackendState,
    router,
    sessions,
    setExecutions,
    setKillSwitchHandoff,
    setLiveVenueReadiness,
    setPolicy,
    startAction,
    toast,
  });

  return {
    activeAgents,
    agentNotificationSummary,
    agents,
    allocationRecommendations,
    approveProposal,
    automaticExitDecisions,
    backendStatus,
    betaReadiness,
    canRunAutonomyScan,
    closeAllOpenPaperTrades,
    closeAutomaticExitTrades,
    closeExecution,
    display,
    encoded,
    encrypt,
    events,
    executeProposal,
    executions,
    gettingStartedSteps,
    inboxSummaries,
    intelligenceByMarket,
    killSwitchHandoff,
    leaderboard,
    liveVenueLoading,
    liveVenueReadiness,
    markAgentNoticeSeen,
    markAllAgentNoticesSeen,
    marketByMarket,
    marketReadiness,
    motionProps,
    openExecutionRecords,
    openExecutions,
    pendingAction,
    policy,
    prepareScoutIdea,
    proposals,
    readiness,
    readyAgents,
    recheckProposal,
    rejectProposal,
    renewSession,
    revokeSession,
    runAutonomyScan,
    scorecards,
    scoutReports,
    seenAgentNotifications,
    sessions,
    setAgentStatus,
    setKillSwitch,
    setupComplete,
    showDeveloperSurfaces,
    startBetaDemo,
    submitVenueProposal,
    unreadAgentNotifications,
  };
}
