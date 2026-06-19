"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  AlertTriangle,
  Bell,
  Bot,
  BrainCircuit,
  Check,
  ChevronDown,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Database,
  Inbox,
  Info,
  KeyRound,
  Lock,
  MessageSquare,
  Pause,
  Plug,
  Plus,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Trophy,
  X,
  type LucideIcon,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  agentLeaderboard,
  recommendAgentAllocation,
  agentRiskSnapshot,
  agentSessionPolicyBindingStatus,
  approveAgentProposal,
  buildAgentAutomaticExitDecisions,
  buildAgentBetaReadiness,
  buildAgentNotifications,
  buildAgentScoutProposal,
  buildAgentScoutReports,
  buildAgentMarketReadiness,
  buildAgentTradeLifecycle,
  buildAgentTradingReadiness,
  closeMockAgentExecution,
  closeOpenMockAgentExecutions,
  canOpenLocalAgentExecution,
  estimateAgentOpenTradePerformance,
  executionUnavailableReason,
  getAgentVaultPolicy,
  hasAgentComplianceAcknowledgement,
  listAgentConnectionKits,
  listAgentEvents,
  listAgentExecutions,
  listAgentOwnerApprovals,
  listAgentProposals,
  listAgentScorecards,
  listAgentSessions,
  listAgents,
  isAgentSessionCurrent,
  newAgentProposalId,
  openAgentPaperTrade,
  rejectAgentProposal,
  recheckAgentProposal,
  renewAgentSession,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  setAgentVaultEmergencyPause,
  setupAgentBetaDemo,
  subscribeAgents,
  syncAgentEmergencyPause,
  syncAgentExecution,
  syncAgentProfile,
  syncAgentProposal,
  syncAgentProposalApproval,
  syncAgentProposalRejection,
  syncAgentSession,
  syncAgentSessionStatus,
  loadAgentBackendState,
  markAgentNotificationSeen,
  markAllAgentNotificationsSeen,
  readSeenAgentNotificationIds,
  getAgentHyperliquidSetupSettings,
  subscribeAgentNotifications,
  updateAgentSessionStatus,
  updateAgentStatus,
  type AgentAuditEvent,
  type AgentAutomaticExitDecision,
  type AgentExecutionRecord,
  type AgentLeaderboardEntry,
  type AgentProfile,
  type AgentScorecard,
  type AgentSessionGrant,
  type AgentTradeProposal,
  type AgentVaultPolicy,
  type AgentKind,
  type AgentMarketDataSnapshot,
  type AgentMarketIntelligenceSnapshot,
  type AgentMarketReadiness,
  type AgentNotification,
  type AgentReadinessAction,
  type AgentScoutReport,
  type TradingVenue,
  type AgentTradingReadiness,
  type AgentAllocationRecommendation,
  type AgentBetaReadiness,
  type AgentKillSwitchHandoff,
  type AgentTradeLifecycle,
  closeAgentExecutionRecord,
} from "@/lib/agents";
import {
  loadAgentInboxSummary,
  type AgentInboxSummary,
} from "@/lib/agents/clientInbox";
import { runAgentAutonomyTickClient } from "@/lib/agents/clientAutonomy";
import {
  loadAgentVenueReadinessForAgents,
  startAgentVenueReadinessPolling,
  submitAgentVenueExecution,
  type AgentVenueRequestRecord,
  type AgentVenueReadiness,
} from "@/lib/agents/clientExecution";
import {
  loadAgentMarketDataSnapshots,
  loadAgentMarketIntelligenceSnapshots,
} from "@/lib/agents/clientMarketData";
import type { HyperliquidTestnetAccountSnapshot } from "@/lib/agents/serverHyperliquidTestnet";
import { toDisplayName } from "@/lib/retail/walletNames";

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

const agentSecondaryActionClass = clsx(
  "inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
);

const agentPrimaryActionClass = clsx(
  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-text-on-accent shadow-accent-rest sm:flex-none",
  "transition-[background-color,box-shadow,transform] duration-base ease-out-soft hover:-translate-y-0.5 hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
);

const agentToolClass = clsx(
  "inline-flex min-h-10 items-center justify-center gap-1.5 rounded-full border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong",
  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
);

type GettingStartedStep = {
  id: string;
  label: string;
  description: string;
  Icon: LucideIcon;
  done: boolean;
  href: string;
  actionLabel: string;
};

export default function AgentsPage() {
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
    void refreshBackendState();
  }, [refreshBackendState]);

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
    void loadAgentMarketIntelligenceSnapshots(watchedMarkets).then((snapshots) => {
      if (!cancelled) setIntelligenceByMarket(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [watchedMarketKey]);

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
        id: "plan",
        label: "Review style",
        description: "Check what it trades and when it exits.",
        Icon: SlidersHorizontal,
        done: itemPassed("strategy"),
        href: firstAgent
          ? `/app/wallet/${encoded}/agents/${encodeURIComponent(firstAgent.id)}/strategy`
          : `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Review style",
      },
      {
        id: "safety",
        label: "Set rules",
        description: "Choose max size, max loss, and stop conditions.",
        Icon: ShieldCheck,
        done: itemPassed("risk-limits"),
        href: `/app/wallet/${encoded}/agents/policy`,
        actionLabel: "Set rules",
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
  ]);

  const prepareScoutIdea = (report: AgentScoutReport) => {
    startAction(async () => {
      if (!policy) {
        toast.error("Finish safety rules before preparing scout ideas");
        return;
      }
      const agent = agents.find((item) => item.id === report.agentId);
      if (!agent) {
        toast.error("Trader not found");
        return;
      }
      const now = Date.now();
      const activeSession =
        sessions.find(
          (session) =>
            session.agentId === agent.id &&
            isAgentSessionCurrent(session, policy, now),
        ) ?? null;
      const built = buildAgentScoutProposal({
        report,
        agent,
        policy,
        session: activeSession,
        risk: agentRiskSnapshot(name, agent.id),
        id: newAgentProposalId(),
        now,
      });
      const result =
        built.evaluation.decision === "allowed" &&
        canOpenLocalAgentExecution(built.proposal.venue)
          ? saveAgentProposalAndExecuteIfAllowed(built.proposal)
          : { proposal: saveAgentProposal(built.proposal), execution: null };
      const syncedProposal = await syncAgentProposal(result.proposal);
      if (result.execution) {
        const syncedExecution = await syncAgentExecution(result.execution);
        if (syncedProposal.ok && syncedExecution.ok) {
          toast.success("Scout idea opened as a practice trade");
          void refreshBackendState();
        } else {
          toast.info("Scout idea opened on this device for now");
        }
        return;
      }
      if (built.evaluation.decision === "allowed") {
        toast.success("Scout idea is ready", {
          details: canOpenLocalAgentExecution(built.proposal.venue)
            ? undefined
            : "Send it to the connected practice venue from Recent trade ideas.",
        });
      } else if (built.evaluation.decision === "requires_human_approval") {
        toast.info("Scout idea needs approval");
      } else {
        toast.info("ClearSig stopped the scout idea", {
          details: built.evaluation.violations[0]?.message,
        });
      }
      if (syncedProposal.ok) {
        void refreshBackendState();
      }
    });
  };

  const runAutonomyScan = () => {
    startAction(() => {
      void runAgentAutonomyTickClient({
        walletName: name,
        venue: "hyperliquid_testnet",
        maxMarkets: 80,
        maxIdeas: 3,
      })
        .then((result) => {
          if (!result.ok) {
            toast.error("Autonomy scan failed", {
              details: result.message,
            });
            return;
          }
          const prepared = result.proposals ?? [];
          for (const item of prepared) {
            saveAgentProposal(item.proposal);
          }
          const placed = prepared.filter((item) => item.execution?.placed).length;
          const handoffBlocked = prepared.filter(
            (item) => item.execution && !item.execution.placed,
          ).length;
          const scanDetails = `${result.scannedMarkets ?? 0} markets scanned · ${result.consideredMarkets ?? 0} tradable`;
          if (prepared.length === 0) {
            toast.info("No trade passed the current max-loss rules", {
              details: `${scanDetails}. ${result.message}`,
            });
          } else if (placed > 0) {
            toast.success(
              `${placed} connected practice trade${placed === 1 ? "" : "s"} sent`,
              {
                details:
                  prepared.length > placed
                    ? `${prepared.length - placed} idea${prepared.length - placed === 1 ? "" : "s"} saved for review.`
                    : scanDetails,
              },
            );
          } else {
            toast.success(
              `${prepared.length} guarded idea${prepared.length === 1 ? "" : "s"} prepared`,
              {
                details:
                  handoffBlocked > 0
                    ? prepared.find((item) => item.execution && !item.execution.placed)
                        ?.execution?.message
                    : scanDetails,
              },
            );
          }
          void refreshBackendState();
        })
        .catch(() => {
          toast.error("Could not run the autonomy scan");
        });
    });
  };

  const setKillSwitch = (enabled: boolean) => {
    startAction(() => {
      const updated = setAgentVaultEmergencyPause(name, enabled);
      setPolicy(updated);
      void syncAgentEmergencyPause(name, enabled).then((synced) => {
        if (synced.ok) {
          setKillSwitchHandoff(synced.killSwitch ?? null);
          toast.success(
            enabled ? "All automatic actions stopped" : "Automatic actions allowed again",
            synced.killSwitch
              ? { details: synced.killSwitch.message }
              : undefined,
          );
          void refreshBackendState();
        } else {
          toast.info("This change is saved on this device for now", {
            details: synced.message,
          });
        }
      });
    });
  };

  const startBetaDemo = () => {
    startAction(() => {
      try {
        const result = setupAgentBetaDemo({ walletName: name });
        toast.success("Beta demo is ready", {
          details: result.firstTradeOpened
            ? "A demo trader, small budget, open practice trade, and trade history are ready to inspect."
            : "A demo trader, small budget, and trade history are ready to inspect.",
        });
        router.push(`/app/wallet/${encoded}/agents/trades`);
      } catch (error) {
        toast.error("Could not start beta demo", {
          details: error instanceof Error ? error.message : String(error),
        });
      }
    });
  };

  const submitVenueProposal = (id: string) => {
    startAction(() => {
      const proposal = proposals.find((item) => item.id === id);
      if (!proposal) {
        toast.error("Trade idea not found");
        return;
      }
      void submitAgentVenueExecution(proposal)
        .then((result) => {
          if (result.ok) {
            toast.success("Trade request sent to the connected practice account");
            return;
          }
          toast.error(
            result.serverRequest
              ? `${result.message} ${result.duplicate ? "It was already saved." : "It was saved."}`
              : result.message,
          );
          if (result.readiness) {
            setLiveVenueReadiness(result.readiness);
          }
        })
        .catch(() => {
          toast.error("Could not check the connected practice account");
        });
    });
  };

  const approveProposal = (id: string) => {
    startAction(() => {
      const updated = approveAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade idea not found");
        return;
      }
      void syncAgentProposalApproval(name, id).then((synced) => {
        if (!synced.ok) {
          toast.info("Trade idea approved on this device for now", {
            details: synced.message,
          });
          return;
        }
        if (synced.value?.status === "blocked") {
          toast.info("Your safety rules stopped this idea", {
            details: synced.value.policyViolations?.[0]?.message,
          });
        } else {
          toast.success("Trade idea approved");
        }
        void refreshBackendState();
      });
    });
  };

  const rejectProposal = (id: string) => {
    startAction(() => {
      const updated = rejectAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade idea not found");
        return;
      }
      void syncAgentProposalRejection(name, id).then((synced) => {
        if (synced.ok) {
          toast.success("Trade idea declined");
          void refreshBackendState();
        } else {
          toast.info("Trade idea declined on this device for now", {
            details: synced.message,
          });
        }
      });
    });
  };

  const executeProposal = (id: string) => {
    startAction(() => {
      const result = openAgentPaperTrade(name, id);
      if (result.reason === "opened") {
        toast.success("Practice trade opened");
        if (result.execution) {
          void syncAgentExecution(result.execution).then((synced) => {
            if (synced.ok) {
              void refreshBackendState();
            } else {
              toast.info("Practice trade saved on this device for now", {
                details: synced.message,
              });
            }
          });
        }
      } else if (result.reason === "already_open") {
        toast.success("Practice trade is already open");
      } else if (result.reason === "blocked") {
        toast.error(
          result.proposal?.policyViolations?.[0]?.message ??
            "Your safety rules stopped this trade idea",
        );
      } else if (result.reason === "backend_required") {
        toast.error("Connect the practice account before using it");
      } else if (result.reason === "not_approved") {
        toast.error("Approve this trade idea first");
      } else {
        toast.error("Trade idea not found");
      }
    });
  };

  const recheckProposal = (id: string) => {
    startAction(() => {
      const result = recheckAgentProposal(name, id);
      if (!result) {
        toast.error("Trade idea not found");
        return;
      }
      if (result.execution) {
        toast.success("Trade idea passed your rules and a practice trade opened");
        void syncAgentExecution(result.execution).then((synced) => {
          if (synced.ok) {
            void refreshBackendState();
          } else {
            toast.info("Practice trade saved on this device for now", {
              details: synced.message,
            });
          }
        });
      } else if (result.proposal.status === "blocked") {
        toast.error("Your safety rules still stop this trade idea");
      } else if (result.proposal.status === "approved") {
        toast.success("Trade idea fits the current budget");
      } else {
        toast.success("Trade idea now needs your approval");
      }
    });
  };

  const closeExecution = (id: string, pnlUsd: string) => {
    startAction(() => {
      const local = closeMockAgentExecution(name, id, pnlUsd);
      const execution = executions.find((item) => item.id === id);
      const proposal = proposals.find((item) => item.id === execution?.proposalId);
      const updated = local ?? (execution
        ? closeAgentExecutionRecord({ execution, proposal, realizedPnlUsd: pnlUsd })
        : null);
      if (!updated) {
        toast.error("Practice trade not found");
        return;
      }
      if (!local) {
        setExecutions((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      toast.success("Practice trade closed");
      void syncAgentExecution(updated).then((synced) => {
        if (synced.ok) {
          void refreshBackendState();
        } else {
          toast.info("Practice trade saved on this device for now", {
            details: synced.message,
          });
        }
      });
    });
  };

  const closeAllOpenPaperTrades = () => {
    startAction(() => {
      const localClosed = closeOpenMockAgentExecutions({ walletName: name });
      const localClosedIds = new Set(localClosed.map((execution) => execution.id));
      const fallbackClosed = openExecutionRecords
        .filter((execution) => !localClosedIds.has(execution.id))
        .map((execution) =>
          closeAgentExecutionRecord({
            execution,
            proposal: proposals.find((item) => item.id === execution.proposalId),
            realizedPnlUsd: "0",
          }),
        );
      const closed = [...localClosed, ...fallbackClosed];
      if (closed.length === 0) {
        toast.error("No open trades to close");
        return;
      }
      if (fallbackClosed.length > 0) {
        setExecutions((current) =>
          current.map(
            (execution) =>
              fallbackClosed.find((closedExecution) => closedExecution.id === execution.id) ??
              execution,
          ),
        );
      }
      toast.success(
        `${closed.length} open practice trade${closed.length === 1 ? "" : "s"} closed`,
      );
      void Promise.all(closed.map((execution) => syncAgentExecution(execution))).then(
        (results) => {
          if (results.every((result) => result.ok)) {
            void refreshBackendState();
          } else {
            toast.info("Practice trades saved on this device for now");
          }
        },
      );
    });
  };

  const closeAutomaticExitTrades = () => {
    startAction(() => {
      if (automaticExitDecisions.length === 0) {
        toast.info("No automatic exits are ready");
        return;
      }
      const closed = automaticExitDecisions.map((decision) => {
        const local = closeMockAgentExecution(
          name,
          decision.execution.id,
          decision.realizedPnlUsd,
        );
        return (
          local ??
          closeAgentExecutionRecord({
            execution: decision.execution,
            proposal: decision.proposal,
            realizedPnlUsd: decision.realizedPnlUsd,
          })
        );
      });
      setExecutions((current) =>
        current.map(
          (execution) =>
            closed.find((closedExecution) => closedExecution.id === execution.id) ??
            execution,
        ),
      );
      toast.success(
        `${closed.length} automatic exit${closed.length === 1 ? "" : "s"} closed`,
      );
      void Promise.all(closed.map((execution) => syncAgentExecution(execution))).then(
        (results) => {
          if (results.every((result) => result.ok)) {
            void refreshBackendState();
          } else {
            toast.info("Automatic exits closed on this device for now");
          }
        },
      );
    });
  };

  const setAgentStatus = (id: string, status: AgentProfile["status"]) => {
    startAction(() => {
      const updated = updateAgentStatus(name, id, status);
      if (!updated) {
        toast.error("Trader not found");
        return;
      }
      void syncAgentProfile(updated).then((synced) => {
        if (synced.ok) {
          toast.success(
            status === "active"
              ? "Trader resumed"
              : status === "paused"
                ? "Trader paused"
                : "Trader access removed",
          );
          void refreshBackendState();
        } else {
          toast.info("Trader change saved on this device for now", {
            details: synced.message,
          });
        }
      });
    });
  };

  const revokeSession = (id: string) => {
    startAction(() => {
      const updated = updateAgentSessionStatus(name, id, "revoked");
      if (!updated) {
        toast.error("Budget not found");
        return;
      }
      void syncAgentSessionStatus(name, id, "revoked").then((synced) => {
        if (synced.ok) {
          toast.success("Budget ended");
          void refreshBackendState();
        } else {
          toast.info("Budget ended on this device for now", {
            details: synced.message,
          });
        }
      });
    });
  };

  const renewSession = (id: string) => {
    startAction(() => {
      const renewed = renewAgentSession(name, id);
      if (!renewed) {
        toast.error("Turn the trader back on before renewing this budget");
        return;
      }
      void syncAgentSession(renewed).then((synced) => {
        if (synced.ok) {
          toast.success("Budget renewed");
          void refreshBackendState();
        } else {
          toast.info("Budget renewed on this device for now", {
            details: synced.message,
          });
        }
      });
    });
  };

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="relative flex flex-col gap-6"
    >
      <header className="overflow-hidden rounded-card border border-accent/25 bg-[#050706] p-4 shadow-card-rest sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Agent vault · {display}
            </p>
            <h1 className="font-display text-display-xs leading-tight text-text-strong md:text-display-sm">
              Agent trading
            </h1>
          </div>
          <Link
            href="/privacy"
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border border-accent/20 bg-accent/[0.06] px-2.5 py-1 text-[11px] font-medium text-accent",
              "transition-colors duration-base ease-out-soft hover:border-accent/50",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
            )}
          >
            <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
            {encrypt.live ? "Privacy on" : "Privacy ready"}
          </Link>
        </div>
        <div className="mt-5 grid gap-2 sm:grid-cols-4">
          <DeskStatus label="Trader" value={activeAgents ? "Chosen" : "Needed"} tone={activeAgents ? "accent" : "warn"} />
          <DeskStatus label="Mode" value="Practice" tone="soft" />
          <DeskStatus
            label="Rules"
            value={policy?.enabled ? "On" : "Needed"}
            tone={policy?.enabled ? "accent" : "warn"}
          />
          <DeskStatus
            label="Pause"
            value={policy?.emergencyPaused ? "Paused" : "Ready"}
            tone={policy?.emergencyPaused ? "warn" : "accent"}
          />
        </div>
      </header>

      <GettingStartedPanel steps={gettingStartedSteps} />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Active traders" value={String(activeAgents)} Icon={Bot} />
        <MetricCard label="Trade ideas" value={String(proposalCount)} Icon={BrainCircuit} />
        <MetricCard label="New ideas" value={String(queuedSignals)} Icon={Inbox} />
        <MetricCard
          label="Rules"
          value={policy?.enabled ? "On" : "Off"}
          Icon={ShieldCheck}
        />
        <MetricCard
          label="Active budgets"
          value={String(activeSessions)}
          Icon={Clock}
        />
        <MetricCard
          label="Open trades"
          value={String(openExecutions)}
          Icon={Play}
        />
      </div>

      <section className="flex flex-col gap-3">
        <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-text-strong">
                Ready desk
              </p>
              <p className="mt-0.5 text-xs text-text-soft">
                Choose a trader, set loss limits, start practice.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Link
                href={`/app/wallet/${encoded}/agents/start`}
                className={agentPrimaryActionClass}
              >
                <Play size={15} aria-hidden="true" />
                Open trading
              </Link>
              {canRunAutonomyScan ? (
                <button
                  type="button"
                  disabled={pendingAction}
                  title="Scan current markets through active rules"
                  onClick={runAutonomyScan}
                  className={agentSecondaryActionClass}
                >
                  <BrainCircuit size={13} aria-hidden="true" />
                  Run scan
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <details className="group rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text-strong">
            <span className="inline-flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
              More
            </span>
            <ChevronDown
              className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Link
            href={`/app/wallet/${encoded}/agents/start`}
            className={agentToolClass}
          >
            <Play size={15} aria-hidden="true" />
            <span>Start practice</span>
          </Link>
          <Link
            href={`/app/wallet/${encoded}/agents/library`}
            className={agentToolClass}
          >
            <Bot size={15} aria-hidden="true" />
            <span>Choose trader</span>
          </Link>
          <Link
            href={`/app/wallet/${encoded}/agents/hyperliquid`}
            className={agentToolClass}
          >
            <Plug size={15} aria-hidden="true" />
            <span>Practice account</span>
          </Link>
          <Link
            href={`/app/wallet/${encoded}/agents/policy`}
            className={agentToolClass}
          >
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Rules</span>
          </Link>
          <Link
            href={`/app/wallet/${encoded}/agents/funding`}
            className={agentToolClass}
          >
            <CircleDollarSign size={15} aria-hidden="true" />
            <span>Budget</span>
          </Link>
          <Link
            href="#kill-switch"
            className={agentToolClass}
          >
            <Pause size={15} aria-hidden="true" />
            <span>Pause</span>
          </Link>
          <Link
            href="#decision-journal"
            className={agentToolClass}
          >
            <ClipboardList size={15} aria-hidden="true" />
            <span>Decision journal</span>
          </Link>
          <Link
            href="#live-monitor"
            className={agentToolClass}
          >
            <TrendingUp size={15} aria-hidden="true" />
            <span>Live monitor</span>
          </Link>
          <Link
            href="/agents"
            className={agentToolClass}
          >
            <Trophy size={13} aria-hidden="true" />
            Marketplace
          </Link>
          </div>
          <details className="group mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-text-strong">
              <span>Advanced</span>
              <ChevronDown
                className="h-3.5 w-3.5 text-text-soft transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 flex flex-wrap items-center gap-2">
            <Link
              href={`/app/wallet/${encoded}/agents/proposals/new`}
              className={clsx(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong sm:flex-none",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
            >
              <Send size={13} aria-hidden="true" />
              Try an idea
            </Link>
            <Link
              href={`/app/wallet/${encoded}/agents/solana`}
              className={clsx(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong sm:flex-none",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
            >
              <KeyRound size={13} aria-hidden="true" />
              Solana delegation
            </Link>
            <Link
              href={`/app/wallet/${encoded}/agents/approvals`}
              className={clsx(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong sm:flex-none",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
            >
              <ClipboardList size={13} aria-hidden="true" />
              Approvals
            </Link>
            <Link
              href={`/app/wallet/${encoded}/agents/feedback`}
              className={clsx(
                "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong sm:flex-none",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              )}
            >
              <MessageSquare size={13} aria-hidden="true" />
              Feedback
            </Link>
            {showDeveloperSurfaces ? (
              <Link
                href={`/app/wallet/${encoded}/agents/admin`}
                className={clsx(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong sm:flex-none",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                )}
              >
                <ClipboardList size={13} aria-hidden="true" />
                Admin
              </Link>
            ) : null}
            {showDeveloperSurfaces ? (
              <button
                type="button"
                disabled={pendingAction}
                onClick={startBetaDemo}
                className={clsx(
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs font-medium text-text-strong sm:flex-none",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                <Sparkles size={13} aria-hidden="true" />
                Seed demo
              </button>
            ) : null}
            </div>
          </details>
        </details>
      </section>

      {policy ? (
        <section id="kill-switch" className="scroll-mt-24">
          <KillSwitchPanel
            paused={policy.emergencyPaused}
            pending={pendingAction}
            executorState={liveVenueReadiness?.executorProbe?.state ?? null}
            handoff={killSwitchHandoff}
            onToggle={setKillSwitch}
          />
        </section>
      ) : null}

      {agentNotificationSummary.notifications.length > 0 ? (
        <AgentNotificationsPanel
          notifications={agentNotificationSummary.notifications}
          seenIds={seenAgentNotifications}
          unreadCount={unreadAgentNotifications.length}
          critical={agentNotificationSummary.critical}
          warning={agentNotificationSummary.warning}
          onMarkSeen={markAgentNoticeSeen}
          onMarkAllSeen={markAllAgentNoticesSeen}
        />
      ) : null}

      {agents.length > 0 ? (
        <ReadinessPanel
          readiness={readiness}
          agents={agents}
          walletEncoded={encoded}
          readyAgents={readyAgents}
        />
      ) : null}

      {scoutReports.length > 0 ? (
        <ScoutPanel
          reports={scoutReports}
          pending={pendingAction}
          onPrepare={prepareScoutIdea}
        />
      ) : null}

      {Object.values(intelligenceByMarket).length > 0 ? (
        <MarketIntelligencePanel
          snapshots={Object.values(intelligenceByMarket)}
        />
      ) : null}

      <section id="live-monitor" className="scroll-mt-24">
        <LiveVenuePanel
          readiness={liveVenueReadiness}
          loading={liveVenueLoading}
          walletEncoded={encoded}
        />
      </section>

      {showDeveloperSurfaces ? (
        <>
          <FeatureAccessPanel
            walletEncoded={encoded}
            agents={agents}
            notifications={agentNotificationSummary.notifications.length}
            marketSnapshots={Object.values(marketByMarket)}
            intelligenceSnapshots={Object.values(intelligenceByMarket)}
            onStartDemo={startBetaDemo}
            pending={pendingAction}
          />
          <BackendPersistencePanel status={backendStatus} />
          {betaReadiness ? <BetaReadinessPanel readiness={betaReadiness} /> : null}
          {marketReadiness ? <MarketReadinessPanel readiness={marketReadiness} /> : null}
        </>
      ) : null}

      {agents.length === 0 ? (
        <EmptyAgents
          browseHref={`/app/wallet/${encoded}/agents/library`}
          createHref={`/app/wallet/${encoded}/agents/new`}
          pending={pendingAction}
          showDemo={showDeveloperSurfaces}
          onStartDemo={startBetaDemo}
        />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Your traders
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                walletEncoded={encoded}
                rank={leaderboard.findIndex((entry) => entry.agentId === agent.id) + 1}
                leaderboard={leaderboard.find((entry) => entry.agentId === agent.id)}
                scorecard={scorecards.find((entry) => entry.agentId === agent.id)}
                allocation={allocationRecommendations[agent.id]}
                inboxSummary={inboxSummaries[agent.id]}
                pending={pendingAction}
                onStatusChange={setAgentStatus}
              />
            ))}
          </ul>
        </section>
      )}

      <section id="decision-journal" className="flex scroll-mt-24 flex-col gap-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
          Decision journal
        </h2>
        {proposals.length > 0 ? (
          <ul className="grid gap-3">
            {proposals.slice(0, 5).map((proposal) => {
              const execution =
                executions.find((item) => item.proposalId === proposal.id) ?? null;
              const venueRequest =
                liveVenueReadiness?.requests?.find(
                  (item) => item.request.proposalId === proposal.id,
                ) ?? null;
              return (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  execution={execution}
                  venueRequest={venueRequest}
                  accountSnapshot={liveVenueReadiness?.accountSnapshot ?? null}
                  pending={pendingAction}
                  onApprove={approveProposal}
                  onReject={rejectProposal}
                  onExecute={executeProposal}
                  onSubmitVenue={submitVenueProposal}
                  onRecheck={recheckProposal}
                />
              );
            })}
          </ul>
        ) : (
          <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-5 text-sm text-text-soft">
            No decisions yet. Choose a trader, set a budget, then run a scan.
          </div>
        )}
      </section>

      {sessions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Practice budgets
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {sessions.slice(0, 4).map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                agent={agents.find((item) => item.id === session.agentId)}
                policy={policy}
                pending={pendingAction}
                onRevoke={revokeSession}
                onRenew={renewSession}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {openExecutionRecords.length > 0 ? (
        <OpenTradeMonitor
          executions={openExecutionRecords}
          marketByMarket={marketByMarket}
          automaticExits={automaticExitDecisions}
          pending={pendingAction}
          onClose={closeExecution}
          onCloseAutomaticExits={closeAutomaticExitTrades}
        />
      ) : null}

      {executions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Trades
            </h2>
            {openExecutions > 0 ? (
              <button
                type="button"
                disabled={pendingAction}
                onClick={closeAllOpenPaperTrades}
                className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-rose-500/30 px-2 py-1 text-[11px] font-medium text-rose-300 transition-colors hover:bg-rose-500/[0.08] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <X className="h-3 w-3" aria-hidden="true" />
                Close all open
              </button>
            ) : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {executions.slice(0, 4).map((execution) => (
              <ExecutionCard
                key={execution.id}
                execution={execution}
                marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
                pending={pendingAction}
                onClose={closeExecution}
              />
            ))}
          </div>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Agent log
          </h2>
          <ul className="grid gap-2">
            {events.slice(0, 6).map((event) => (
              <AuditEventRow key={event.id} event={event} />
            ))}
          </ul>
        </section>
      ) : null}
    </motion.div>
  );
}

function DeskStatus({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "accent" | "soft" | "warn";
}) {
  return (
    <div
      className={clsx(
        "rounded-soft border px-3 py-2",
        tone === "accent"
          ? "border-accent/25 bg-accent/[0.06]"
          : tone === "warn"
            ? "border-warning/30 bg-warning/[0.06]"
            : "border-white/10 bg-white/[0.03]",
      )}
    >
      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-text-soft">
        {label}
      </p>
      <p
        className={clsx(
          "mt-1 font-numerals text-sm font-semibold tabular-nums",
          tone === "warn" ? "text-warning" : tone === "accent" ? "text-accent" : "text-text-strong",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function GettingStartedPanel({ steps }: { steps: GettingStartedStep[] }) {
  const currentIndex = steps.findIndex((step) => !step.done);
  const currentStep = currentIndex === -1 ? steps.length - 1 : currentIndex;
  const completed = steps.filter((step) => step.done).length;

  return (
    <section className="rounded-card border border-accent/25 bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-strong">
            {completed === steps.length ? "Ready to trade" : "Fast start"}
          </p>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          {completed} of {steps.length} complete
        </span>
      </div>

      <ol className="mt-4 grid gap-2 sm:grid-cols-5">
        {steps.map((step, index) => {
          const current = index === currentStep && !step.done;
          const StepIcon = step.Icon;
          return (
            <li
              key={step.id}
              className={clsx(
                "flex min-h-[8rem] flex-col gap-3 rounded-soft border px-3 py-3",
                current
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-border-soft bg-canvas",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={clsx(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border",
                    step.done
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : current
                        ? "border-accent bg-accent text-text-on-accent"
                        : "border-border-soft text-text-muted",
                  )}
                >
                  {step.done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    <StepIcon className="h-4 w-4" aria-hidden="true" />
                  )}
                </span>
                <details className="group relative">
                  <summary className="flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                    <span className="sr-only">{step.label} details</span>
                  </summary>
                  <p className="absolute right-0 z-10 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-soft border border-border-soft bg-surface-elevated p-2 text-[11px] leading-relaxed text-text-soft shadow-card-raised">
                    {step.description}
                  </p>
                </details>
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-text-strong">{step.label}</p>
                <p className="mt-0.5 text-[11px] font-medium text-text-soft">
                  {step.done ? "Done" : current ? "Next" : "Waiting"}
                </p>
              </div>
              {current ? (
                <Link
                  href={step.href}
                  className="mt-auto inline-flex min-h-9 items-center justify-center gap-1 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
                >
                  {step.actionLabel}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function FeatureAccessPanel({
  walletEncoded,
  agents,
  notifications,
  marketSnapshots,
  intelligenceSnapshots,
  pending,
  onStartDemo,
}: {
  walletEncoded: string;
  agents: AgentProfile[];
  notifications: number;
  marketSnapshots: AgentMarketDataSnapshot[];
  intelligenceSnapshots: AgentMarketIntelligenceSnapshot[];
  pending: boolean;
  onStartDemo: () => void;
}) {
  const publishedAgents = agents.filter((agent) => agent.publishing?.status === "published");
  const newsConnected = intelligenceSnapshots.some((snapshot) => snapshot.coverage.news);
  const macroConnected = intelligenceSnapshots.some((snapshot) => snapshot.coverage.macro);
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-strong">Practice tools</h2>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
            Create sample activity, browse traders, or open a public profile.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={onStartDemo}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          Create sample activity
        </button>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        <FeatureAccessCard
          title="Marketplace"
          body="Browse approved public agents and separated track records."
          status="Open"
          href="/agents"
          Icon={Trophy}
        />
        <FeatureAccessCard
          title="Public profiles"
          body={
            publishedAgents.length > 0
              ? `${publishedAgents.length} published profile${publishedAgents.length === 1 ? "" : "s"} in this wallet.`
              : "Publish and approve an agent to make its public profile visible."
          }
          status={publishedAgents.length > 0 ? "Ready" : "Needs published agent"}
          href={
            publishedAgents[0]?.publishing
              ? `/agents/${walletEncoded}/${encodeURIComponent(publishedAgents[0].publishing.slug)}`
              : `/app/wallet/${walletEncoded}/agents/library`
          }
          Icon={ShieldCheck}
        />
        <FeatureAccessCard
          title="Market intelligence"
          body={`${marketSnapshots.length} priced market${marketSnapshots.length === 1 ? "" : "s"} · news ${newsConnected ? "on" : "not connected"} · macro ${macroConnected ? "on" : "not connected"}.`}
          status={marketSnapshots.length > 0 ? "Visible in scout" : "Needs active trader"}
          href={`/app/wallet/${walletEncoded}/agents/start`}
          Icon={Database}
        />
        <FeatureAccessCard
          title="Notifications"
          body={
            notifications > 0
              ? `${notifications} current trading notice${notifications === 1 ? "" : "s"}.`
              : "No active trading notices yet. Demo setup can create testable state."
          }
          status={notifications > 0 ? "Ready" : "Empty"}
          href={`/app/wallet/${walletEncoded}/agents`}
          Icon={Bell}
        />
      </div>
    </section>
  );
}

function FeatureAccessCard({
  title,
  body,
  status,
  href,
  Icon,
}: {
  title: string;
  body: string;
  status: string;
  href: string;
  Icon: typeof Bot;
}) {
  return (
    <Link
      href={href}
      className="rounded-soft border border-border-soft bg-canvas p-3 transition-colors hover:border-accent/50"
    >
      <div className="flex items-start gap-2">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-xs font-semibold text-text-strong">{title}</p>
            <span className="rounded-full border border-border-soft px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
              {status}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">{body}</p>
        </div>
      </div>
    </Link>
  );
}

function ReadinessPanel({
  readiness,
  agents,
  walletEncoded,
  readyAgents,
}: {
  readiness: AgentTradingReadiness[];
  agents: AgentProfile[];
  walletEncoded: string;
  readyAgents: number;
}) {
  const topItems = [...readiness].sort(readinessSort).slice(0, 3);
  const blocked = readiness.filter((item) => item.status === "blocked").length;
  const setup = readiness.filter((item) => item.status === "needs_setup").length;
  const headline =
    readyAgents > 0
      ? `${readyAgents} trader${readyAgents === 1 ? "" : "s"} ready`
      : blocked > 0
        ? "Trading has stopped"
        : "A few steps remain";
  const summary =
    readyAgents > 0
      ? "Ready for guarded trades."
      : blocked > 0
        ? "Open the trader below."
        : "Finish setup first.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={clsx(
                "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                readyAgents > 0
                  ? "bg-accent/10 text-accent"
                  : blocked > 0
                    ? "bg-rose-500/[0.08] text-rose-300"
                    : "bg-warning/[0.08] text-warning",
              )}
            >
              {readyAgents > 0 ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              )}
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Ready to trade?
              </h2>
              <p className="mt-0.5 text-xs text-text-soft">{headline}</p>
            </div>
          </div>
          <p className="mt-2 text-xs text-text-soft">{summary}</p>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          {setup} to finish · {blocked} stopped
        </span>
      </div>
      <div className="mt-4 grid gap-2">
        {topItems.map((item) => {
          const agent = agents.find((entry) => entry.id === item.agentId);
          return (
            <ReadinessRow
              key={item.agentId}
              agent={agent}
              readiness={item}
              walletEncoded={walletEncoded}
            />
          );
        })}
      </div>
    </section>
  );
}

function ScoutPanel({
  reports,
  pending,
  onPrepare,
}: {
  reports: AgentScoutReport[];
  pending: boolean;
  onPrepare: (report: AgentScoutReport) => void;
}) {
  const ready = reports.filter((report) => report.status === "ready").length;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <BrainCircuit className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Agent scout
              </h2>
              <p className="mt-0.5 text-xs text-text-soft">
                {ready} ready · {reports.length} watching
              </p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          Scout · Analyze · Gate
        </span>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {reports.map((report) => (
          <ScoutCard
            key={report.id}
            report={report}
            pending={pending}
            onPrepare={onPrepare}
          />
        ))}
      </div>
    </section>
  );
}

function MarketIntelligencePanel({
  snapshots,
}: {
  snapshots: AgentMarketIntelligenceSnapshot[];
}) {
  const connectedNews = snapshots.filter((snapshot) => snapshot.coverage.news).length;
  const connectedMacro = snapshots.filter((snapshot) => snapshot.coverage.macro).length;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <Database className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-strong">
                Market intelligence
              </h2>
              <p className="mt-0.5 text-xs text-text-soft">
                {snapshots.length} market{snapshots.length === 1 ? "" : "s"} · news {connectedNews > 0 ? "connected" : "not connected"} · macro {connectedMacro > 0 ? "connected" : "not connected"}
              </p>
            </div>
          </div>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          Price · Funding · News · Macro
        </span>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {snapshots.slice(0, 4).map((snapshot) => (
          <article
            key={snapshot.market}
            className="rounded-soft border border-border-soft bg-canvas p-3"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold text-text-strong">
                  {snapshot.market}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-text-soft">
                  {snapshot.summary}
                </p>
              </div>
              <span
                className={clsx(
                  "rounded-full border px-2 py-1 text-[10px] font-medium",
                  snapshot.freshnessWarnings.length > 0
                    ? "border-warning/30 bg-warning/[0.08] text-warning"
                    : "border-accent/30 bg-accent/[0.08] text-accent",
                )}
              >
                {snapshot.marketData.source === "live" ? "Live market" : "Practice market"}
              </span>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ScoutMiniMetric
                label="Mark"
                value={formatUsd(snapshot.marketData.markPriceUsd)}
              />
              <ScoutMiniMetric
                label="Funding"
                value={
                  snapshot.marketData.fundingRatePct == null
                    ? "Unknown"
                    : `${snapshot.marketData.fundingRatePct}%`
                }
              />
              <ScoutMiniMetric label="Items" value={String(snapshot.items.length)} />
            </div>
            <div className="mt-3 grid gap-2">
              {snapshot.items.slice(0, 5).map((item) => (
                <div
                  key={`${item.kind}:${item.id}`}
                  className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={clsx(
                        "rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                        item.source === "coverage-gap"
                          ? "border-warning/30 bg-warning/[0.08] text-warning"
                          : item.impact === "bullish"
                            ? "border-accent/30 bg-accent/[0.08] text-accent"
                            : item.impact === "bearish"
                              ? "border-danger/30 bg-danger/[0.06] text-danger"
                              : "border-border-soft bg-canvas text-text-soft",
                      )}
                    >
                      {item.kind.replace("_", " ")}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-text-strong">
                      {item.label}
                    </p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-soft">
                    {item.summary}
                  </p>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ScoutCard({
  report,
  pending,
  onPrepare,
}: {
  report: AgentScoutReport;
  pending: boolean;
  onPrepare: (report: AgentScoutReport) => void;
}) {
  return (
    <article className="rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-strong">
            {report.market} · {report.side}
          </p>
          <p className="mt-0.5 text-xs text-text-soft">{report.agentName}</p>
        </div>
        <ScoutStatusPill status={report.status} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <ScoutMiniMetric label="Score" value={`${report.score}/100`} />
        <ScoutMiniMetric
          label="Mark"
          value={report.snapshot ? formatUsd(report.snapshot.markPriceUsd) : "Waiting"}
        />
        <ScoutMiniMetric
          label="Funding"
          value={
            report.snapshot?.fundingRatePct == null
              ? "Unknown"
              : `${report.snapshot.fundingRatePct}%`
          }
        />
      </div>
      <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-text-soft">
        {report.thesis}
      </p>
      <div className="mt-3 grid gap-2">
        <ScoutMiniReason label="News" value={report.newsSummary} />
        <ScoutMiniReason label="Macro" value={report.fundamentalSummary} />
        <ScoutMiniReason label="Risk" value={report.riskPlan} />
        <ScoutMiniReason label="Gate" value={report.policySummary} />
      </div>
      <button
        type="button"
        disabled={pending || report.status === "blocked"}
        onClick={() => onPrepare(report)}
        className={clsx(
          "mt-3 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-soft px-3 py-2 text-xs font-medium",
          "transition-colors duration-base ease-out-soft",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          "disabled:cursor-not-allowed disabled:opacity-60",
          report.status === "ready"
            ? "bg-accent text-text-on-accent hover:bg-accent-hover"
            : "border border-border-soft text-text-strong hover:border-accent/60 hover:text-accent",
        )}
      >
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        {report.status === "ready" ? "Prepare and open" : "Prepare idea"}
      </button>
    </article>
  );
}

function ScoutStatusPill({ status }: { status: AgentScoutReport["status"] }) {
  const label =
    status === "ready"
      ? "Ready"
      : status === "needs_approval"
        ? "Approval"
        : status === "blocked"
          ? "Stopped"
          : "Watching";
  return (
    <span
      className={clsx(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        status === "ready" && "border-accent/30 bg-accent/[0.08] text-accent",
        status === "needs_approval" && "border-warning/30 bg-warning/[0.08] text-warning",
        status === "blocked" && "border-rose-500/30 bg-rose-500/[0.08] text-rose-300",
        status === "watching" && "border-border-soft bg-surface-raised text-text-soft",
      )}
    >
      {label}
    </span>
  );
}

function ScoutMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 truncate text-[11px] font-semibold text-text-strong">
        {value}
      </p>
    </div>
  );
}

function ScoutMiniReason({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-strong">
        {value}
      </p>
    </div>
  );
}

function KillSwitchPanel({
  paused,
  pending,
  executorState,
  handoff,
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  executorState: "not_configured" | "unavailable" | "ready" | null;
  handoff: AgentKillSwitchHandoff | null;
  onToggle: (enabled: boolean) => void;
}) {
  const executorReady = executorState === "ready";
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest",
        paused
          ? "border-rose-500/30 bg-rose-500/[0.08]"
          : "border-border-soft bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              paused ? "bg-rose-500/[0.12] text-rose-300" : "bg-accent/10 text-accent",
            )}
          >
            {paused ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-strong">
              {paused ? "All automatic actions are stopped" : "Automatic actions are allowed"}
            </p>
            <p className="mt-1 text-xs text-text-soft">
              {paused
                ? executorReady
                  ? "Trading is paused. The connected account stop path is configured."
                  : "Trading is paused. Connected account stop path still needs setup."
                : executorReady
                  ? "Kill switch can also notify the connected practice executor."
                  : "Kill switch will pause ClearSig; finish practice account setup for executor handoff."}
            </p>
            <span
              className={clsx(
                "mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                executorReady
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
              )}
            >
              Protected executor {executorReady ? "ready" : "pending"}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(!paused)}
          className={clsx(
            "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border px-3 py-2 text-xs font-medium",
            "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            paused
              ? "border-accent/30 text-accent hover:bg-accent/[0.08]"
              : "border-rose-500/30 text-rose-300 hover:bg-rose-500/[0.08]",
          )}
        >
          {paused ? (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {paused ? "Allow trading again" : "Stop all trading"}
        </button>
      </div>
      {handoff ? (
        <div
          className={clsx(
            "mt-3 rounded-soft border px-3 py-2",
            handoff.state === "sent"
              ? "border-accent/25 bg-accent/[0.06]"
              : handoff.state === "failed"
                ? "border-rose-500/30 bg-rose-500/[0.08]"
                : "border-warning/30 bg-warning/[0.08]",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {handoff.state === "sent" ? (
              <Check className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
            ) : handoff.state === "failed" ? (
              <X className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
            )}
            <p className="text-xs font-semibold text-text-strong">
              {killSwitchHandoffLabel(handoff)}
            </p>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {handoff.message}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function killSwitchHandoffLabel(handoff: AgentKillSwitchHandoff): string {
  switch (handoff.state) {
    case "sent":
      return "Executor stop sent";
    case "failed":
      return "Executor stop failed";
    case "not_configured":
      return "Executor not configured";
    case "not_requested":
      return "Executor stop not requested";
  }
}

function AgentNotificationsPanel({
  notifications,
  seenIds,
  unreadCount,
  critical,
  warning,
  onMarkSeen,
  onMarkAllSeen,
}: {
  notifications: AgentNotification[];
  seenIds: Set<string>;
  unreadCount: number;
  critical: number;
  warning: number;
  onMarkSeen: (id: string) => void;
  onMarkAllSeen: () => void;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              critical > 0
                ? "bg-rose-500/[0.10] text-rose-300"
                : warning > 0
                  ? "bg-warning/[0.08] text-warning"
                  : "bg-accent/10 text-accent",
            )}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Trading notifications
            </h2>
            <p className="mt-1 text-xs text-text-soft">
              {unreadCount > 0
                ? `${unreadCount} unread notice${unreadCount === 1 ? "" : "s"} need attention.`
                : "All current trading notices have been read."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
            {critical} urgent · {warning} warning
          </span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onMarkAllSeen}
              className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
            >
              Mark all read
            </button>
          ) : null}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="mt-4 rounded-soft border border-dashed border-border-soft bg-canvas px-3 py-3">
          <p className="text-xs font-semibold text-text-strong">
            No trading notices right now
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            Notices appear here when a trade needs approval, an idea is blocked,
            a trade opens or closes, a budget is near expiry, or marketplace
            review changes.
          </p>
        </div>
      ) : (
      <ul className="mt-4 grid gap-2">
        {notifications.slice(0, 5).map((notification) => {
          const seen = seenIds.has(notification.id);
          return (
            <li
              key={notification.id}
              className={clsx(
                "rounded-soft border px-3 py-3",
                seen
                  ? "border-border-soft bg-canvas"
                  : notification.severity === "critical"
                    ? "border-rose-500/30 bg-rose-500/[0.08]"
                    : notification.severity === "warning"
                      ? "border-warning/30 bg-warning/[0.08]"
                      : "border-accent/20 bg-accent/[0.05]",
              )}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <Link
                  href={notification.href}
                  onClick={() => onMarkSeen(notification.id)}
                  className="min-w-0 flex-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-xs font-semibold text-text-strong">
                      {notification.title}
                    </p>
                    {!seen ? (
                      <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-text-on-accent">
                        New
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-soft">
                    {notification.body}
                  </p>
                  <p className="mt-1 text-[11px] text-text-soft">
                    {formatAgentNoticeTime(notification.createdAt)}
                  </p>
                </Link>
                {!seen ? (
                  <button
                    type="button"
                    onClick={() => onMarkSeen(notification.id)}
                    className="inline-flex min-h-8 items-center justify-center rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
                  >
                    Read
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      )}
    </section>
  );
}

function LiveVenuePanel({
  readiness,
  loading,
  walletEncoded,
}: {
  readiness: AgentVenueReadiness | null;
  loading: boolean;
  walletEncoded: string;
}) {
  const connected =
    readiness?.state === "ready" &&
    readiness.executorProbe?.state === "ready" &&
    readiness.accountProbe?.state === "funded";
  const unavailable = !loading && !readiness;
  const reconciliation = readiness?.reconciliation ?? null;
  const title = loading
    ? "Checking practice account"
    : connected
      ? `${readiness.label} account connected`
      : readiness
        ? `${readiness.label} account needs setup`
        : "Practice account not connected";
  const summary = loading
    ? "Checking whether your trader can safely place trades."
    : connected
      ? "The account has practice funds and the protected trading connection is ready."
      : unavailable
        ? "The practice account check is unavailable right now."
        : readiness?.accountProbe?.state === "empty"
          ? "The account is connected, but it still needs practice funds."
          : readiness?.executorProbe?.state === "unavailable"
            ? "The account is known, but the protected trading connection could not be reached."
            : readiness?.executorProbe?.message ??
              readiness?.accountProbe?.message ??
              "Built-in practice works now. Connect a practice account when you are ready.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              connected
                ? "bg-accent/10 text-accent"
                : "bg-warning/[0.08] text-warning",
            )}
          >
            {connected ? (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plug className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Practice account
            </h2>
            <p className="mt-0.5 text-xs font-medium text-text-soft">
              {title}
            </p>
            <details className="group mt-1">
              <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Practice account details</span>
              </summary>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-soft">
                {summary}
              </p>
            </details>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              connected
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : "border-warning/30 bg-warning/[0.08] text-warning",
            )}
          >
            {loading ? "Checking" : connected ? "Connected" : "Needs setup"}
          </span>
          <Link
            href={`/app/wallet/${walletEncoded}/agents/hyperliquid`}
            className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
          >
            Set up Hyperliquid
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
      {reconciliation ? (
        <div className="mt-4 grid gap-2 border-t border-border-soft pt-3 sm:grid-cols-4">
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Venue check
            </p>
            <p
              className={clsx(
                "mt-1 text-xs font-semibold",
                reconciliation.status === "healthy"
                  ? "text-accent"
                  : reconciliation.status === "blocked"
                    ? "text-danger"
                    : "text-warning",
              )}
            >
              {reconciliation.label}
            </p>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Submitted
            </p>
            <p className="mt-1 text-xs font-semibold text-text-strong">
              {reconciliation.submittedRequests}
            </p>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Live positions
            </p>
            <p className="mt-1 text-xs font-semibold text-text-strong">
              {reconciliation.exchangeOpenPositions}
            </p>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Mismatches
            </p>
            <p className="mt-1 text-xs font-semibold text-text-strong">
              {reconciliation.unmatchedPositions + reconciliation.missingOrderIds}
            </p>
          </div>
          {reconciliation.issues.length > 0 ? (
            <ul className="grid gap-2 sm:col-span-4 md:grid-cols-3">
              {reconciliation.issues.slice(0, 3).map((issue) => (
                <li
                  key={issue.id}
                  className={clsx(
                    "rounded-soft border px-3 py-2",
                    issue.severity === "block"
                      ? "border-rose-500/30 bg-rose-500/[0.08]"
                      : "border-warning/30 bg-warning/[0.08]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {issue.severity === "block" ? (
                      <X className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                    )}
                    <p className="truncate text-xs font-semibold text-text-strong">
                      {issue.label}
                    </p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-soft">
                    {issue.message}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ReadinessRow({
  agent,
  readiness,
  walletEncoded,
}: {
  agent?: AgentProfile;
  readiness: AgentTradingReadiness;
  walletEncoded: string;
}) {
  const href = readinessHref(walletEncoded, readiness.agentId, readiness.primaryAction);
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-xs font-semibold text-text-strong">
            {agent?.name ?? "Trader"}
            </p>
            <span
              className={clsx(
                "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                readinessStatusTone(readiness.status),
              )}
            >
              {readiness.score}% · {readiness.headline}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {readiness.summary}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          {readinessActionLabel(readiness.primaryAction)}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: typeof Bot;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-text-soft">{label}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-text-strong">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyAgents({
  browseHref,
  createHref,
  pending,
  showDemo,
  onStartDemo,
}: {
  browseHref: string;
  createHref: string;
  pending: boolean;
  showDemo: boolean;
  onStartDemo: () => void;
}) {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Bot className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-4 font-display text-base font-semibold text-text-strong">
        No agents yet
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href={browseHref}
          className="inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
        >
          <Bot size={13} aria-hidden="true" />
          Choose trader
        </Link>
        <Link
          href={createHref}
          className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong"
        >
          <Plus size={13} aria-hidden="true" />
          Create your own
        </Link>
        {showDemo ? (
          <button
            type="button"
            disabled={pending}
            onClick={onStartDemo}
            className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Sparkles size={13} aria-hidden="true" />
            Create sample activity
          </button>
        ) : null}
      </div>
    </div>
  );
}

function BackendPersistencePanel({
  status,
}: {
  status: BackendPersistenceStatus;
}) {
  const synced = status.state === "synced";
  const checking = status.state === "checking";
  const title = checking
    ? "Checking saved changes"
    : synced
      ? "Changes are saved"
      : "Saved on this device";
  const summary = checking
    ? "Making sure your latest changes are available."
    : synced
      ? "Your traders, ideas, budgets, and history are saved."
      : "You can keep working here. Wider access will return when saving reconnects.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              synced ? "bg-accent/10 text-accent" : "bg-warning/[0.08] text-warning",
            )}
          >
            <Database className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Saving
            </h2>
            <p className="mt-0.5 text-xs font-medium text-text-soft">
              {title}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              {summary}
            </p>
            {synced ? (
              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-text-soft">
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.agents} traders
                </span>
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.proposals} ideas
                </span>
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.sessions} budgets
                </span>
                <span className="rounded-full border border-border-soft px-2 py-1">
                  {status.events} updates
                </span>
              </div>
            ) : null}
          </div>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            synced
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : "border-warning/30 bg-warning/[0.08] text-warning",
          )}
          title={
            status.updatedAt
              ? new Date(status.updatedAt).toLocaleString()
              : undefined
          }
        >
          {checking ? "Checking" : synced ? "Saved" : "This device"}
        </span>
      </div>
    </section>
  );
}

function BetaReadinessPanel({
  readiness,
}: {
  readiness: AgentBetaReadiness;
}) {
  const ready = readiness.status === "ready";
  const blocked = readiness.status === "blocked";
  const topChecks = readiness.checks
    .filter((check) => check.status !== "pass")
    .slice(0, 4);
  const visibleChecks =
    topChecks.length > 0 ? topChecks : readiness.checks.slice(0, 4);
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest",
        ready
          ? "border-accent/30 bg-accent/[0.06]"
          : blocked
            ? "border-rose-500/30 bg-rose-500/[0.08]"
            : "border-warning/30 bg-warning/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              ready
                ? "bg-accent/10 text-accent"
                : blocked
                  ? "bg-rose-500/[0.12] text-rose-300"
                  : "bg-warning/[0.12] text-warning",
            )}
          >
            {ready ? (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Developer readiness
              </h2>
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  ready
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : blocked
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {readiness.score}% · {readiness.headline}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              {readiness.summary}
            </p>
          </div>
        </div>
        <Link
          href={topChecks[0]?.href ?? readiness.checks[0]?.href ?? "#"}
          className="inline-flex min-h-9 items-center justify-center gap-1 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          Review
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {visibleChecks.map((check) => (
          <div
            key={check.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  check.status === "pass"
                    ? "bg-accent"
                    : check.status === "block"
                      ? "bg-rose-400"
                      : "bg-warning",
                )}
              />
              <p className="text-xs font-semibold text-text-strong">
                {check.label}
              </p>
              {check.href ? (
                <Link
                  href={check.href}
                  className="text-[11px] font-medium text-accent hover:text-accent-hover"
                >
                  Open
                </Link>
              ) : null}
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {check.message}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MarketReadinessPanel({
  readiness,
}: {
  readiness: AgentMarketReadiness;
}) {
  const blockers = readiness.checks
    .filter((check) => check.status === "block")
    .slice(0, 5);
  const nextChecks =
    blockers.length > 0
      ? blockers
      : readiness.checks.filter((check) => check.status === "todo").slice(0, 5);

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              readiness.status === "ready"
                ? "bg-accent/10 text-accent"
                : readiness.status === "blocked"
                  ? "bg-rose-500/[0.12] text-rose-300"
                  : "bg-warning/[0.12] text-warning",
            )}
          >
            {readiness.status === "ready" ? (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Database className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Market readiness
              </h2>
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  readiness.status === "ready"
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : readiness.status === "blocked"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {readiness.score}% · {readiness.headline}
              </span>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-text-soft">
              {readiness.summary}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-2 md:grid-cols-3">
        {readiness.phases.map((phase) => (
          <div
            key={phase.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-strong">
                {phase.label}
              </p>
              <span
                className={clsx(
                  "rounded-full border px-2 py-0.5 text-[10px] font-medium",
                  phase.status === "ready"
                    ? "border-accent/30 bg-accent/[0.08] text-accent"
                    : phase.status === "blocked"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : "border-warning/30 bg-warning/[0.08] text-warning",
                )}
              >
                {phase.score}%
              </span>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {phase.summary}
            </p>
          </div>
        ))}
      </div>

      {nextChecks.length > 0 ? (
        <div className="mt-4 grid gap-2 md:grid-cols-2">
          {nextChecks.map((check) => (
            <div
              key={check.id}
              className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={clsx(
                    "h-2 w-2 rounded-full",
                    check.status === "block" ? "bg-rose-400" : "bg-warning",
                  )}
                />
                <p className="text-xs font-semibold text-text-strong">
                  {check.label}
                </p>
                <span className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
                  {check.category}
                </span>
                {check.href ? (
                  <Link
                    href={check.href}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:text-accent-hover"
                  >
                    Open
                    <ArrowRight className="h-3 w-3" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">
                {check.message}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function OpenTradeMonitor({
  executions,
  marketByMarket,
  automaticExits,
  pending,
  onClose,
  onCloseAutomaticExits,
}: {
  executions: AgentExecutionRecord[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  automaticExits: AgentAutomaticExitDecision[];
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
  onCloseAutomaticExits: () => void;
}) {
  const estimates = executions
    .map((execution) => ({
      execution,
      performance: estimateAgentOpenTradePerformance(
        execution,
        marketByMarket[execution.market.trim().toUpperCase()] ?? null,
      ),
    }))
    .filter((item) => item.performance);
  const estimatedPnl = estimates.reduce(
    (sum, item) => sum + Number(item.performance?.unrealizedPnlUsd ?? 0),
    0,
  );
  const pricedCount = estimates.length;

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <TrendingUp className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Open trade performance
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-soft">
              {pricedCount > 0
                ? `${pricedCount} of ${executions.length} open practice trade${executions.length === 1 ? "" : "s"} have a fresh mark. Estimated open P/L is ${formatSignedUsd(String(estimatedPnl))}.`
                : "Waiting for a market mark before estimating open practice P/L."}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            estimatedPnl > 0
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : estimatedPnl < 0
                ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                : "border-border-soft bg-canvas text-text-soft",
          )}
        >
          {formatSignedUsd(String(estimatedPnl))}
        </span>
      </div>
      {automaticExits.length > 0 ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-soft border border-accent/25 bg-accent/[0.06] px-3 py-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-strong">
              Automatic exit ready
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-text-soft">
              {automaticExits[0]?.summary}
            </p>
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={onCloseAutomaticExits}
            className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft bg-accent px-2.5 py-1.5 text-[11px] font-medium text-text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Close automatically
          </button>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {executions.slice(0, 4).map((execution) => (
          <ExecutionCard
            key={execution.id}
            execution={execution}
            marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
            pending={pending}
            onClose={onClose}
          />
        ))}
      </div>
    </section>
  );
}

function AgentCard({
  agent,
  walletEncoded,
  rank,
  leaderboard,
  scorecard,
  allocation,
  inboxSummary,
  pending,
  onStatusChange,
}: {
  agent: AgentProfile;
  walletEncoded: string;
  rank: number;
  leaderboard?: AgentLeaderboardEntry;
  scorecard?: AgentScorecard;
  allocation?: AgentAllocationRecommendation;
  inboxSummary?: AgentInboxSummary;
  pending: boolean;
  onStatusChange: (id: string, status: AgentProfile["status"]) => void;
}) {
  const statusTone =
    agent.status === "active"
      ? "border-accent/30 bg-accent/[0.08] text-accent"
      : agent.status === "paused"
        ? "border-warning/30 bg-warning/[0.08] text-warning"
        : "border-rose-500/30 bg-rose-500/[0.08] text-rose-500";
  const published = agent.publishing?.status === "published";

  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Bot className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-strong">
              {agent.name}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                statusTone,
              )}
            >
              {agent.status}
            </span>
            {published ? (
              <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                Published
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs capitalize text-text-soft">
            {agentKindLabel(agent.kind)}
          </p>
          {agent.description ? (
            <details className="group mt-1">
              <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">{agent.name} profile</span>
              </summary>
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-soft">
                {agent.description}
              </p>
            </details>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft">
              <Trophy className="h-3 w-3" aria-hidden="true" />
              {rank > 0 ? `Rank #${rank}` : "Unranked"}
            </span>
            <span className="inline-flex items-center rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft">
              Safety score {leaderboard?.score ?? 50}
            </span>
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                inboxSummary?.count
                  ? "border-warning/30 bg-warning/[0.08] text-warning"
                  : "border-border-soft bg-canvas text-text-soft",
              )}
            >
              <Inbox className="h-3 w-3" aria-hidden="true" />
              {inboxSummary?.status === "unavailable"
                ? "Ideas unavailable"
                : `${inboxSummary?.count ?? 0} new`}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <ScoreStat label="Profit/loss" value={formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")} />
            <ScoreStat label="Trades" value={String(scorecard?.executed ?? 0)} />
            <ScoreStat label="Stopped" value={String(scorecard?.ruleViolations ?? 0)} />
            <ScoreStat
              label="Largest fall"
              value={`${formatNumber(scorecard?.maxDrawdownPct ?? 0)}%`}
            />
          </div>
          {allocation ? (
            <div className="mt-3 border-t border-border-soft pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-text-strong">
                    Recommended budget
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-text-soft">
                    {allocation.summary}
                  </p>
                </div>
                <span
                  className={clsx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    allocation.action === "demote"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : allocation.action === "promote"
                        ? "border-accent/30 bg-accent/[0.08] text-accent"
                        : "border-border-soft bg-canvas text-text-soft",
                  )}
                >
                  {allocation.action} · {allocation.tier.label}
                </span>
              </div>
              {allocation.nextTier && allocation.nextTierGaps.length > 0 ? (
                <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-text-soft">
                  Next level: {allocation.nextTier.label} needs{" "}
                  {allocation.nextTierGaps.slice(0, 2).join(" and ")}.
                </p>
              ) : null}
              {agent.status === "active" ? (
                <Link
                  href={`/app/wallet/${walletEncoded}/agents/sessions/new?agent=${encodeURIComponent(agent.id)}&allocationTier=${allocation.tier.id}`}
                  className="mt-2 inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  Review budget
                </Link>
              ) : null}
            </div>
          ) : null}
          {agent.publishing?.status === "published" ? (
            <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-text-strong">
                    Public profile
                  </p>
                  <p className="mt-0.5 text-xs text-text-soft">
                    {agent.publishing.moderation?.status === "approved"
                      ? "Visible in the public profile and marketplace."
                      : `Waiting for ${agent.publishing.moderation?.status?.replace("_", " ") ?? "review"}.`}
                  </p>
                </div>
                <Link
                  href={
                    agent.publishing.moderation?.status === "approved"
                      ? `/agents/${walletEncoded}/${encodeURIComponent(agent.publishing.slug)}`
                      : `/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}#publishing`
                  }
                  className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
                >
                  {agent.publishing.moderation?.status === "approved" ? "Open profile" : "Review"}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {agent.status === "active" ? (
              <ActionButton
                label="Pause"
                Icon={Clock}
                disabled={pending}
                onClick={() => onStatusChange(agent.id, "paused")}
              />
            ) : agent.status === "paused" ? (
              <ActionButton
                label="Resume"
                Icon={Check}
                disabled={pending}
                onClick={() => onStatusChange(agent.id, "active")}
              />
            ) : (
              <ActionButton
                label="Reactivate"
                Icon={RefreshCw}
                disabled={pending}
                onClick={() => onStatusChange(agent.id, "active")}
              />
            )}
            {agent.status !== "revoked" ? (
              <ActionButton
                label="Revoke"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => onStatusChange(agent.id, "revoked")}
              />
            ) : null}
            <Link
              href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}`}
              className={clsx(
                "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              )}
            >
              Details
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
            <Link
              href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}#publishing`}
              className={clsx(
                "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              )}
            >
              <Send className="h-3 w-3" aria-hidden="true" />
              {published ? "Profile" : "Publish"}
            </Link>
            {agent.kind === "mock" ? (
              <Link
                href={`/app/wallet/${walletEncoded}/agents/start?agent=${encodeURIComponent(agent.id)}`}
                className={clsx(
                  "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                )}
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                Start practice
              </Link>
            ) : (
              <Link
                href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}/connection`}
                className={clsx(
                  "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                )}
              >
                <Plug className="h-3 w-3" aria-hidden="true" />
                Connect trader
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 truncate font-medium text-text-strong">{value}</p>
    </div>
  );
}

function ProposalCard({
  proposal,
  execution,
  venueRequest,
  accountSnapshot,
  pending,
  onApprove,
  onReject,
  onExecute,
  onSubmitVenue,
  onRecheck,
}: {
  proposal: AgentTradeProposal;
  execution: AgentExecutionRecord | null;
  venueRequest: AgentVenueRequestRecord | null;
  accountSnapshot: HyperliquidTestnetAccountSnapshot | null;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
  onSubmitVenue: (id: string) => void;
  onRecheck: (id: string) => void;
}) {
  const lifecycle = buildAgentTradeLifecycle({
    proposal,
    execution,
    venueRequest,
    accountSnapshot,
  });

  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {proposal.market} · {proposal.side}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                lifecycleToneClass(lifecycle.tone),
              )}
            >
              {lifecycle.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {tradingPlaceLabel(proposal.venue)} · ${proposal.notionalUsd} ·{" "}
            {proposal.leverage}x
          </p>
          <TradeLifecycleStrip lifecycle={lifecycle} />
          {proposal.policyViolations && proposal.policyViolations.length > 0 ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-rose-300">
              {proposal.policyViolations[0]?.message}
            </p>
          ) : null}
          {proposal.decisionJournal ? (
            <DecisionJournalSummary proposal={proposal} />
          ) : proposal.thesis ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">
              {proposal.thesis}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] font-medium text-text-soft">
            Confidence {proposal.confidence}%
          </span>
          <ProposalActions
            proposal={proposal}
            pending={pending}
            onApprove={onApprove}
            onReject={onReject}
            onExecute={onExecute}
            onSubmitVenue={onSubmitVenue}
            onRecheck={onRecheck}
          />
        </div>
      </div>
    </li>
  );
}

function TradeLifecycleStrip({ lifecycle }: { lifecycle: AgentTradeLifecycle }) {
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-5">
      {lifecycle.steps.map((step) => {
        const Icon = lifecycleStepIcon(step.status);
        return (
          <div
            key={step.id}
            title={step.detail}
            className={clsx(
              "flex min-h-10 items-center gap-2 rounded-soft border px-2 py-1.5",
              lifecycleStepClass(step.status),
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold">{step.label}</p>
              <p className="truncate text-[10px] opacity-75">{step.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function DecisionJournalSummary({ proposal }: { proposal: AgentTradeProposal }) {
  const journal = proposal.decisionJournal;
  if (!journal) return null;
  return (
    <div className="mt-3 rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-text-strong">
          Why this trade
        </p>
        <details className="group">
          <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Decision details</span>
          </summary>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
            <MiniReason label="Risk" value={journal.riskPlan} />
            <MiniReason label="Exit" value={journal.exitPlan} />
            <MiniReason label="Rules" value={journal.policySummary} />
          </div>
          {journal.evidence.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {journal.evidence.slice(0, 4).map((item) => (
                <span
                  key={item.id}
                  className="rounded-full border border-border-soft bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-soft"
                >
                  {evidenceLabel(item.kind)}
                </span>
              ))}
            </div>
          ) : null}
        </details>
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-text-soft">
        {journal.summary}
      </p>
    </div>
  );
}

function lifecycleToneClass(tone: AgentTradeLifecycle["tone"]): string {
  switch (tone) {
    case "success":
      return "border-accent/30 bg-accent/[0.08] text-accent";
    case "warning":
      return "border-warning/30 bg-warning/[0.08] text-warning";
    case "danger":
      return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
    case "default":
      return "border-border-soft bg-canvas text-text-soft";
  }
}

function lifecycleStepClass(status: AgentTradeLifecycle["steps"][number]["status"]): string {
  switch (status) {
    case "done":
      return "border-accent/25 bg-accent/[0.06] text-accent";
    case "current":
      return "border-warning/25 bg-warning/[0.06] text-warning";
    case "blocked":
      return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
    case "warning":
      return "border-warning/30 bg-warning/[0.08] text-warning";
    case "waiting":
      return "border-border-soft bg-canvas text-text-soft";
  }
}

function lifecycleStepIcon(
  status: AgentTradeLifecycle["steps"][number]["status"],
): typeof Check {
  switch (status) {
    case "done":
      return Check;
    case "current":
      return Clock;
    case "blocked":
      return X;
    case "warning":
      return AlertTriangle;
    case "waiting":
      return Clock;
  }
}

function MiniReason({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-strong">
        {value}
      </p>
    </div>
  );
}

function ProposalActions({
  proposal,
  pending,
  onApprove,
  onReject,
  onExecute,
  onSubmitVenue,
  onRecheck,
}: {
  proposal: AgentTradeProposal;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
  onSubmitVenue: (id: string) => void;
  onRecheck: (id: string) => void;
}) {
  if (proposal.status === "rejected") {
    return null;
  }
  if (proposal.status === "blocked") {
    return (
      <ActionButton
        label="Check safety again"
        Icon={RefreshCw}
        disabled={pending}
        onClick={() => onRecheck(proposal.id)}
      />
    );
  }
  if (proposal.status === "executed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-soft border border-accent/30 bg-accent/[0.08] px-2 py-1 text-[11px] font-medium text-accent">
        <Check className="h-3 w-3" aria-hidden="true" />
        Opened
      </span>
    );
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {proposal.status === "needs_approval" ? (
        <>
          <ActionButton
            label="Approve"
            Icon={Check}
            disabled={pending}
            onClick={() => onApprove(proposal.id)}
          />
          <ActionButton
            label="Decline"
            Icon={X}
            disabled={pending}
            tone="danger"
            onClick={() => onReject(proposal.id)}
          />
        </>
      ) : null}
      {proposal.status === "approved" ? (
        canOpenLocalAgentExecution(proposal.venue) ? (
          <ActionButton
            label="Open guarded trade"
            Icon={Play}
            disabled={pending}
            onClick={() => onExecute(proposal.id)}
          />
        ) : (
          <ActionButton
            label="Send to venue"
            Icon={Plug}
            disabled={pending}
            onClick={() => onSubmitVenue(proposal.id)}
            title={executionUnavailableReason(proposal.venue) ?? undefined}
          />
        )
      ) : null}
    </div>
  );
}

function ActionButton({
  label,
  Icon,
  disabled,
  tone = "default",
  onClick,
  title,
}: {
  label: string;
  Icon: typeof Check;
  disabled: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={title}
      className={clsx(
        "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border px-2 py-1 text-[11px] font-medium",
        "transition-colors duration-base ease-out-soft",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
        "disabled:cursor-not-allowed disabled:opacity-60",
        tone === "danger"
          ? "border-rose-500/30 text-rose-300 hover:bg-rose-500/[0.08]"
          : "border-border-soft text-text-strong hover:border-accent/60 hover:text-accent",
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </button>
  );
}

function ExecutionCard({
  execution,
  marketSnapshot,
  pending,
  onClose,
}: {
  execution: AgentExecutionRecord;
  marketSnapshot: AgentMarketDataSnapshot | null;
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
}) {
  const [pnlUsd, setPnlUsd] = useState("");
  const isOpen = execution.status === "open";
  const pnl = Number(execution.realizedPnlUsd || 0);
  const performance = estimateAgentOpenTradePerformance(execution, marketSnapshot);
  return (
    <article className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Play className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-strong">
              {execution.market} · {execution.side}
            </p>
            <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/[0.08] px-1.5 py-0.5 text-[10px] font-medium capitalize text-accent">
              {isOpen ? "Open" : "Closed"}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {tradingPlaceLabel(execution.venue)} · ${execution.notionalUsd} ·{" "}
            {execution.leverage}x
          </p>
          {isOpen ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ScoreStat label="Entry" value={formatUsd(execution.entryPrice ?? "0")} />
              <ScoreStat
                label="Mark"
                value={performance ? formatUsd(performance.markPriceUsd) : "Waiting"}
              />
              <ScoreStat
                label="Est. P/L"
                value={performance ? formatSignedUsd(performance.unrealizedPnlUsd) : "Unknown"}
              />
              <ScoreStat
                label="Move"
                value={performance ? `${formatNumber(performance.movePct)}%` : "Unknown"}
              />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-soft">
            <span>Opened {new Date(execution.openedAt).toLocaleString()}</span>
            {!isOpen ? (
              <span
                className={clsx(
                  "font-medium",
                  pnl > 0 ? "text-accent" : pnl < 0 ? "text-rose-300" : "text-text-soft",
                )}
              >
                Profit/loss {formatSignedUsd(execution.realizedPnlUsd)}
              </span>
            ) : null}
          </div>
          {isOpen ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`pnl-${execution.id}`}>
                Profit or loss in USD
              </label>
              <input
                id={`pnl-${execution.id}`}
                value={pnlUsd}
                onChange={(event) => setPnlUsd(event.target.value)}
                inputMode="decimal"
                placeholder="Profit/loss"
                className={clsx(
                  "min-h-8 w-28 rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs text-text-strong",
                  "placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
                )}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  onClose(execution.id, pnlUsd || performance?.unrealizedPnlUsd || "0")
                }
                className={clsx(
                  "inline-flex min-h-8 items-center justify-center rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Close trade
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function AuditEventRow({ event }: { event: AgentAuditEvent }) {
  return (
    <li className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 shadow-card-rest">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-strong">{event.message}</p>
        <span className="text-[11px] text-text-soft">
          {new Date(event.createdAt).toLocaleString()}
        </span>
      </div>
    </li>
  );
}

function agentKindLabel(kind: AgentKind): string {
  switch (kind) {
    case "mock":
      return "Built-in practice trader";
    case "api":
      return "Connected trader";
    case "hermes":
      return "Independent trader";
    case "manual":
      return "Person";
  }
}

function readinessSort(a: AgentTradingReadiness, b: AgentTradingReadiness): number {
  const weight = (status: AgentTradingReadiness["status"]) => {
    switch (status) {
      case "blocked":
        return 0;
      case "needs_setup":
        return 1;
      case "ready":
        return 2;
    }
  };
  const statusDelta = weight(a.status) - weight(b.status);
  return statusDelta !== 0 ? statusDelta : a.score - b.score;
}

function readinessStatusTone(status: AgentTradingReadiness["status"]): string {
  switch (status) {
    case "ready":
      return "border-accent/30 bg-accent/[0.08] text-accent";
    case "blocked":
      return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
    case "needs_setup":
      return "border-warning/30 bg-warning/[0.08] text-warning";
  }
}

function readinessHref(
  walletEncoded: string,
  agentId: string,
  action: AgentReadinessAction,
): string {
  switch (action) {
    case "risk_limits":
      return `/app/wallet/${walletEncoded}/agents/policy`;
    case "strategy":
      return `/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agentId)}/strategy`;
    case "session":
      return `/app/wallet/${walletEncoded}/agents/sessions/new`;
    case "agent":
    case "none":
      return `/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agentId)}`;
  }
}

function readinessActionLabel(action: AgentReadinessAction): string {
  switch (action) {
    case "risk_limits":
      return "Set rules";
    case "strategy":
      return "Review style";
    case "session":
      return "Set budget";
    case "agent":
      return "Review trader";
    case "none":
      return "View";
  }
}

function tradingPlaceLabel(venue: TradingVenue): string {
  switch (venue) {
    case "mock_perps":
      return "Built-in practice";
    case "hyperliquid_testnet":
      return "Connected practice";
    case "bulktrade_mock":
      return "Bulk practice";
  }
}

function evidenceLabel(
  kind: NonNullable<AgentTradeProposal["decisionJournal"]>["evidence"][number]["kind"],
): string {
  switch (kind) {
    case "market_data":
      return "Market data";
    case "technical":
      return "Technical";
    case "fundamental":
      return "Fundamental";
    case "news":
      return "News";
    case "macro":
      return "Macro";
    case "strategy":
      return "Strategy";
    case "risk":
      return "Risk";
  }
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
}

function formatAgentNoticeTime(value: number): string {
  const deltaMs = Date.now() - value;
  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString();
}

function SessionCard({
  session,
  agent,
  policy,
  pending,
  onRevoke,
  onRenew,
}: {
  session: AgentSessionGrant;
  agent?: AgentProfile;
  policy: AgentVaultPolicy | null;
  pending: boolean;
  onRevoke: (id: string) => void;
  onRenew: (id: string) => void;
}) {
  const timeActive = session.status === "active" && session.expiresAt > Date.now();
  const bindingStatus = policy
    ? agentSessionPolicyBindingStatus(session, policy)
    : "missing";
  const active = timeActive && bindingStatus === "current";
  const stale = timeActive && bindingStatus !== "current";
  const displayStatus = active
    ? "Active"
    : stale
      ? "Needs renewal"
    : session.status === "active" && session.expiresAt <= Date.now()
      ? "expired"
      : session.status;
  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Clock className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-strong">
              {agent?.name ?? "Unknown trader"}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                active
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : stale
                    ? "border-warning/30 bg-warning/[0.08] text-warning"
                  : "border-border-soft bg-canvas text-text-soft",
              )}
            >
              {displayStatus}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {session.allowedMarkets?.join(", ") || "Allowed markets"} ·{" "}
            ${session.maxNotionalUsd ?? "limit"} · {session.maxLeverage ?? "limit"}x
          </p>
          <p className="mt-2 text-[11px] text-text-soft">
            {stale
              ? "Your safety rules changed after this budget was set."
              : `Expires ${new Date(session.expiresAt).toLocaleString()}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {active ? (
              <ActionButton
                label="End budget"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => onRevoke(session.id)}
              />
            ) : (
              <ActionButton
                label="Renew budget"
                Icon={RefreshCw}
                disabled={pending}
                onClick={() => onRenew(session.id)}
              />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
