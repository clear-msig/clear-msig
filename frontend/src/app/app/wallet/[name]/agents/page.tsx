"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  AlertTriangle,
  Bot,
  BrainCircuit,
  Check,
  CircleDollarSign,
  ClipboardList,
  Clock,
  Database,
  Inbox,
  Lock,
  MessageSquare,
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
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  agentLeaderboard,
  recommendAgentAllocation,
  agentRiskSnapshot,
  agentSessionPolicyBindingStatus,
  approveAgentProposal,
  buildAgentBetaReadiness,
  buildAgentTradingReadiness,
  closeMockAgentExecution,
  closeOpenMockAgentExecutions,
  canOpenLocalAgentExecution,
  estimateAgentOpenTradePerformance,
  executionUnavailableReason,
  getAgentVaultPolicy,
  listAgentConnectionKits,
  listAgentEvents,
  listAgentExecutions,
  listAgentOwnerApprovals,
  listAgentProposals,
  listAgentScorecards,
  listAgentSessions,
  listAgents,
  isAgentSessionCurrent,
  openAgentPaperTrade,
  rejectAgentProposal,
  recheckAgentProposal,
  renewAgentSession,
  setAgentVaultEmergencyPause,
  setupAgentBetaDemo,
  subscribeAgents,
  syncAgentEmergencyPause,
  syncAgentExecution,
  syncAgentProfile,
  syncAgentProposalApproval,
  syncAgentProposalRejection,
  syncAgentSession,
  syncAgentSessionStatus,
  loadAgentBackendState,
  getAgentHyperliquidSetupSettings,
  updateAgentSessionStatus,
  updateAgentStatus,
  type AgentAuditEvent,
  type AgentExecutionRecord,
  type AgentLeaderboardEntry,
  type AgentProfile,
  type AgentScorecard,
  type AgentSessionGrant,
  type AgentTradeProposal,
  type AgentVaultPolicy,
  type AgentKind,
  type AgentMarketDataSnapshot,
  type AgentReadinessAction,
  type AgentProposalStatus,
  type TradingVenue,
  type AgentTradingReadiness,
  type AgentAllocationRecommendation,
  type AgentBetaReadiness,
} from "@/lib/agents";
import {
  loadAgentInboxSummary,
  type AgentInboxSummary,
} from "@/lib/agents/clientInbox";
import {
  loadAgentVenueReadiness,
  submitAgentVenueExecution,
  type AgentVenueReadiness,
} from "@/lib/agents/clientExecution";
import { loadAgentMarketDataSnapshots } from "@/lib/agents/clientMarketData";
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

type GettingStartedStep = {
  id: string;
  label: string;
  description: string;
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
  const [liveVenueReadiness, setLiveVenueReadiness] =
    useState<AgentVenueReadiness | null>(null);
  const [liveVenueLoading, setLiveVenueLoading] = useState(true);
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

  useEffect(() => {
    let cancelled = false;
    setLiveVenueLoading(true);
    const setup = getAgentHyperliquidSetupSettings(name);
    loadAgentVenueReadiness("hyperliquid_testnet", {
      accountAddress: setup.accountAddress,
    })
      .then((readiness) => {
        if (!cancelled) setLiveVenueReadiness(readiness);
      })
      .catch(() => {
        if (!cancelled) setLiveVenueReadiness(null);
      })
      .finally(() => {
        if (!cancelled) setLiveVenueLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const openExecutionRecords = useMemo(
    () => executions.filter((execution) => execution.status === "open"),
    [executions],
  );
  const openMarketKey = useMemo(
    () =>
      openExecutionRecords
        .map((execution) => execution.market.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join("|"),
    [openExecutionRecords],
  );

  useEffect(() => {
    const openMarkets = openMarketKey ? openMarketKey.split("|") : [];
    if (openMarkets.length === 0) {
      setMarketByMarket({});
      return;
    }
    let cancelled = false;
    void loadAgentMarketDataSnapshots(openMarkets).then((snapshots) => {
      if (!cancelled) setMarketByMarket(snapshots);
    });
    return () => {
      cancelled = true;
    };
  }, [openMarketKey]);

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
        label: "Choose your trader",
        description: "Pick a prepared ClearSig trader or create one of your own.",
        done: Boolean(firstAgent),
        href: `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Browse traders",
      },
      {
        id: "plan",
        label: "Describe how it should trade",
        description: "Set the markets it can watch, when it may act, and when it must stop.",
        done: itemPassed("strategy"),
        href: firstAgent
          ? `/app/wallet/${encoded}/agents/${encodeURIComponent(firstAgent.id)}/strategy`
          : `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Set trading plan",
      },
      {
        id: "safety",
        label: "Choose your safety rules",
        description: "Set the most it can use, the most it can lose, and what it may trade.",
        done: itemPassed("risk-limits"),
        href: `/app/wallet/${encoded}/agents/policy`,
        actionLabel: "Choose safety rules",
      },
      {
        id: "allowance",
        label: "Give it a practice allowance",
        description: "Choose a small amount and a short time for its first safe trial.",
        done: itemPassed("session"),
        href: firstAgent
          ? `/app/wallet/${encoded}/agents/sessions/new?agent=${encodeURIComponent(firstAgent.id)}`
          : `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Set practice allowance",
      },
      {
        id: "practice",
        label: "Start trading",
        description: "Choose a practice account, confirm every required step, and place the first practice trade.",
        done: hasFirstPractice,
        href: firstAgent
          ? `/app/wallet/${encoded}/agents/start?agent=${encodeURIComponent(firstAgent.id)}`
          : `/app/wallet/${encoded}/agents/library`,
        actionLabel: "Start trading",
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

  const setKillSwitch = (enabled: boolean) => {
    startAction(() => {
      const updated = setAgentVaultEmergencyPause(name, enabled);
      setPolicy(updated);
      void syncAgentEmergencyPause(name, enabled).then((synced) => {
        if (synced.ok) {
          toast.success(
            enabled ? "All automated trading stopped" : "Automated trading allowed again",
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
            ? "A demo agent, safe allowance, open paper trade, and trade history are ready to inspect."
            : "A demo agent, safe allowance, and trade history are ready to inspect.",
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
            toast.success("Trade request sent to the practice account");
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
          toast.error("Could not check the outside practice account");
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
        toast.error("Connect the outside practice account before using it");
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
        toast.success("Trade idea fits the current allowance");
      } else {
        toast.success("Trade idea now needs your approval");
      }
    });
  };

  const closeExecution = (id: string, pnlUsd: string) => {
    startAction(() => {
      const updated = closeMockAgentExecution(name, id, pnlUsd);
      if (!updated) {
        toast.error("Practice trade not found");
        return;
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
      const closed = closeOpenMockAgentExecutions({ walletName: name });
      if (closed.length === 0) {
        toast.error("No open practice trades to close");
        return;
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
        toast.error("Practice allowance not found");
        return;
      }
      void syncAgentSessionStatus(name, id, "revoked").then((synced) => {
        if (synced.ok) {
          toast.success("Practice allowance ended");
          void refreshBackendState();
        } else {
          toast.info("Practice allowance ended on this device for now", {
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
        toast.error("Turn the trader back on before renewing this allowance");
        return;
      }
      void syncAgentSession(renewed).then((synced) => {
        if (synced.ok) {
          toast.success("Practice allowance renewed");
          void refreshBackendState();
        } else {
          toast.info("Practice allowance renewed on this device for now", {
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
      className="flex flex-col gap-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Automated Trading · {display}
          </p>
          <h1 className="font-display text-lg leading-tight text-text-strong md:text-display-xs">
            Automated Trading
          </h1>
          <p className="max-w-2xl text-xs leading-relaxed text-text-soft sm:text-sm">
            Let an agent prove itself with practice money first. You choose the
            limits, approve more only when it earns your trust, and can stop it at any time.
          </p>
        </div>
        <Link
          href="/privacy"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft",
            "transition-colors duration-base ease-out-soft hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          {encrypt.live ? "Privacy on" : "Privacy ready"}
        </Link>
      </header>

      <GettingStartedPanel steps={gettingStartedSteps} />

      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <MetricCard label="Active traders" value={String(activeAgents)} Icon={Bot} />
        <MetricCard label="Trade ideas" value={String(proposalCount)} Icon={BrainCircuit} />
        <MetricCard label="New ideas" value={String(queuedSignals)} Icon={Inbox} />
        <MetricCard
          label="Safety rules"
          value={policy?.enabled ? "On" : "Off"}
          Icon={ShieldCheck}
        />
        <MetricCard
          label="Active allowances"
          value={String(activeSessions)}
          Icon={Clock}
        />
        <MetricCard
          label="Open practice trades"
          value={String(openExecutions)}
          Icon={Play}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {showDeveloperSurfaces ? (
          <button
            type="button"
            disabled={pendingAction}
            onClick={startBetaDemo}
            className={clsx(
              "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest sm:flex-none",
              "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
              "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            <Sparkles size={13} aria-hidden="true" />
            Seed demo
          </button>
        ) : null}
        <Link
          href={`/app/wallet/${encoded}/agents/library`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Bot size={13} aria-hidden="true" />
          Agent Library
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/start`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Play size={13} aria-hidden="true" />
          Start trading
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/proposals/new`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Send size={13} aria-hidden="true" />
          Try an idea
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/funding`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <CircleDollarSign size={13} aria-hidden="true" />
          Fund traders
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/trades`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <TrendingUp size={13} aria-hidden="true" />
          Trades
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/hyperliquid`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Plug size={13} aria-hidden="true" />
          Hyperliquid
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/approvals`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
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
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <MessageSquare size={13} aria-hidden="true" />
          Feedback
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/policy`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          Safety rules
        </Link>
      </div>

      {policy ? (
        <KillSwitchPanel
          paused={policy.emergencyPaused}
          pending={pendingAction}
          onToggle={setKillSwitch}
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

      <LiveVenuePanel
        readiness={liveVenueReadiness}
        loading={liveVenueLoading}
        walletEncoded={encoded}
      />

      {showDeveloperSurfaces ? (
        <>
          <BackendPersistencePanel status={backendStatus} />
          {betaReadiness ? <BetaReadinessPanel readiness={betaReadiness} /> : null}
        </>
      ) : null}

      {agents.length === 0 ? (
        <EmptyAgents
          browseHref={`/app/wallet/${encoded}/agents/library`}
          createHref={`/app/wallet/${encoded}/agents/new`}
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

      {proposals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Recent trade ideas
          </h2>
          <ul className="grid gap-3">
            {proposals.slice(0, 5).map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                pending={pendingAction}
                onApprove={approveProposal}
                onReject={rejectProposal}
                onExecute={executeProposal}
                onSubmitVenue={submitVenueProposal}
                onRecheck={recheckProposal}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {sessions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Practice allowances
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
          pending={pendingAction}
          onClose={closeExecution}
        />
      ) : null}

      {executions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
              Practice trades
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

function GettingStartedPanel({ steps }: { steps: GettingStartedStep[] }) {
  const currentIndex = steps.findIndex((step) => !step.done);
  const currentStep = currentIndex === -1 ? steps.length - 1 : currentIndex;
  const completed = steps.filter((step) => step.done).length;

  return (
    <section className="rounded-card border border-accent/25 bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-strong">
            {completed === steps.length ? "Your trader is up and running" : "Your next step"}
          </p>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-soft">
            ClearSig keeps your money under your control. Your trader can only use
            the amount and time you approve.
          </p>
        </div>
        <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
          {completed} of {steps.length} complete
        </span>
      </div>

      <ol className="mt-4 grid gap-2">
        {steps.map((step, index) => {
          const current = index === currentStep && !step.done;
          return (
            <li
              key={step.id}
              className={clsx(
                "flex flex-wrap items-center gap-3 rounded-soft border px-3 py-3",
                current
                  ? "border-accent/40 bg-accent/[0.06]"
                  : "border-border-soft bg-canvas",
              )}
            >
              <span
                className={clsx(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold",
                  step.done
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : current
                      ? "border-accent bg-accent text-text-on-accent"
                      : "border-border-soft text-text-muted",
                )}
              >
                {step.done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
              </span>
              <div className="min-w-[12rem] flex-1">
                <p className="text-xs font-semibold text-text-strong">{step.label}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-text-soft">
                  {step.description}
                </p>
              </div>
              {current ? (
                <Link
                  href={step.href}
                  className="inline-flex min-h-9 items-center justify-center gap-1 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
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
      ? "Ready traders can open practice trades when an idea fits your safety rules."
      : blocked > 0
        ? "Open the trader below to see what needs your attention."
        : "Finish the next step before your trader can begin practicing.";

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
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-soft">
            {summary}
          </p>
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

function KillSwitchPanel({
  paused,
  pending,
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
}) {
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
              {paused ? "All automated trading is stopped" : "Automated trading is allowed"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              {paused
                ? "No trader can open a new trade until you turn it back on."
                : "You can stop every trader immediately whenever you need to."}
            </p>
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
  const title = loading
    ? "Checking practice account"
    : connected
      ? `${readiness.label} practice account connected`
      : readiness
        ? `${readiness.label} practice account needs setup`
        : "Practice account not connected";
  const summary = loading
    ? "Checking whether your trader can safely place practice trades."
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
              "Built-in practice trading works now. Connect an outside practice account when you are ready.";

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
              Outside practice account
            </h2>
            <p className="mt-0.5 text-xs font-medium text-text-soft">
              {title}
            </p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-soft">
              {summary}
            </p>
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
}: {
  browseHref: string;
  createHref: string;
}) {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Bot className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-4 font-display text-base font-semibold text-text-strong">
        No agents yet
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-soft">
        Choose a prepared ClearSig agent for the easiest start, or create your
        own and shape its trading plan.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link
          href={browseHref}
          className="inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
        >
          <Bot size={13} aria-hidden="true" />
          Agent Library
        </Link>
        <Link
          href={createHref}
          className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong"
        >
          <Plus size={13} aria-hidden="true" />
          Create your own
        </Link>
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
      ? "Your traders, ideas, allowances, and history are saved."
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
                  {status.sessions} allowances
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

function OpenTradeMonitor({
  executions,
  marketByMarket,
  pending,
  onClose,
}: {
  executions: AgentExecutionRecord[];
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
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
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">
              {agent.description}
            </p>
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
                    Recommended allowance
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-text-soft">
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
                <p className="mt-2 text-[11px] leading-relaxed text-text-soft">
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
                  Review allowance
                </Link>
              ) : null}
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
                Start trading
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
  const statusTone =
    proposal.status === "blocked"
      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-500"
      : proposal.status === "approved" || proposal.status === "executed"
        ? "border-accent/30 bg-accent/[0.08] text-accent"
        : "border-warning/30 bg-warning/[0.08] text-warning";

  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {proposal.market} · {proposal.side}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                statusTone,
              )}
            >
              {proposalStatusLabel(proposal.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {tradingPlaceLabel(proposal.venue)} · ${proposal.notionalUsd} ·{" "}
            {proposal.leverage}x
          </p>
          {proposal.policyViolations && proposal.policyViolations.length > 0 ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-rose-300">
              {proposal.policyViolations[0]?.message}
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
            label="Open practice trade"
            Icon={Play}
            disabled={pending}
            onClick={() => onExecute(proposal.id)}
          />
        ) : (
          <ActionButton
            label="Send to practice account"
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

function proposalStatusLabel(status: AgentProposalStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "blocked":
      return "Stopped";
    case "needs_approval":
      return "Needs approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Declined";
    case "executed":
      return "Opened";
    case "expired":
      return "Expired";
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
      return "Safety rules";
    case "strategy":
      return "Trading plan";
    case "session":
      return "Give allowance";
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
      return "Hyperliquid Testnet";
    case "bulktrade_mock":
      return "Built-in practice";
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
              ? "Your safety rules changed after this allowance was given."
              : `Expires ${new Date(session.expiresAt).toLocaleString()}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {active ? (
              <ActionButton
                label="End allowance"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => onRevoke(session.id)}
              />
            ) : (
              <ActionButton
                label="Renew allowance"
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
