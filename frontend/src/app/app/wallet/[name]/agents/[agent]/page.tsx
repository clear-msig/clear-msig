"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowRight,
  ArrowLeft,
  AlertTriangle,
  Bot,
  Check,
  Clock,
  Copy,
  Globe,
  Inbox,
  Lock,
  PencilLine,
  Plug,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  agentLeaderboard,
  agentLibraryMetrics,
  agentSessionPolicyBindingStatus,
  approveAgentProposal,
  buildAgentTradingReadiness,
  canOpenLocalAgentExecution,
  closeAgentExecutionRecord,
  closeMockAgentExecution,
  closeOpenMockAgentExecutions,
  estimateAgentOpenTradePerformance,
  executionUnavailableReason,
  findAgent,
  getAgentVaultPolicy,
  agentRiskSnapshot,
  listAgentEvents,
  listAgentExecutions,
  listAgentProposals,
  listAgentScorecards,
  listAgentSessions,
  isAgentSessionCurrent,
  moderateAgentPublishingProfile,
  openAgentPaperTrade,
  publishAgentProfile,
  rejectAgentProposal,
  recommendAgentAllocation,
  recheckAgentProposal,
  renewAgentSession,
  setAgentVaultEmergencyPause,
  subscribeAgents,
  syncAgentEmergencyPause,
  syncAgentExecution,
  syncAgentProfile,
  syncAgentProposalApproval,
  syncAgentProposalRejection,
  syncAgentSession,
  syncAgentSessionStatus,
  updateAgentSessionStatus,
  updateAgentStatus,
  unpublishAgentProfile,
  type AgentAuditEvent,
  type AgentAllocationRecommendation,
  type AgentExecutionRecord,
  type AgentKind,
  type AgentLeaderboardEntry,
  type AgentLibraryMetrics,
  type AgentMarketDataSnapshot,
  type AgentModerationStatus,
  type AgentReadinessAction,
  type AgentRiskSnapshot,
  type AgentProfile,
  type AgentProposalStatus,
  type AgentScorecard,
  type AgentSessionGrant,
  type AgentTradeProposal,
  type AgentTradingReadiness,
  type AgentTradingMode,
  type AgentVaultPolicy,
  type TradingVenue,
  saveAgent,
} from "@/lib/agents/client";
import {
  loadAgentInboxSummary,
  type AgentInboxSummary,
} from "@/lib/agents/clientInbox";
import { submitAgentVenueExecution } from "@/lib/agents/clientExecution";
import { loadAgentMarketDataSnapshots } from "@/lib/agents/clientMarketData";
import { publicProfileUrl } from "@/lib/agents/publicProfile";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function AgentDetailPage() {
  const params = useParams<{ name: string; agent: string }>();
  const toast = useToast();
  const encrypt = encryptStatus();
  const [pending, startAction] = useTransition();

  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const agentId = useMemo(() => decodeParam(params?.agent), [params?.agent]);
  const encodedWallet = encodeURIComponent(name);
  const display = toDisplayName(name);

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<AgentLeaderboardEntry | undefined>();
  const [scorecard, setScorecard] = useState<AgentScorecard | undefined>();
  const [risk, setRisk] = useState<AgentRiskSnapshot | null>(null);
  const [readiness, setReadiness] = useState<AgentTradingReadiness | null>(null);
  const [emergencyPaused, setEmergencyPaused] = useState(false);
  const [dailyLossCapUsd, setDailyLossCapUsd] = useState("100");
  const [policy, setPolicy] = useState<AgentVaultPolicy | null>(null);
  const [proposals, setProposals] = useState<AgentTradeProposal[]>([]);
  const [sessions, setSessions] = useState<AgentSessionGrant[]>([]);
  const [executions, setExecutions] = useState<AgentExecutionRecord[]>([]);
  const [events, setEvents] = useState<AgentAuditEvent[]>([]);
  const [inboxSummary, setInboxSummary] = useState<AgentInboxSummary | null>(null);
  const [marketByMarket, setMarketByMarket] = useState<Record<string, AgentMarketDataSnapshot>>({});
  const [editingAgent, setEditingAgent] = useState(false);
  const [agentNameDraft, setAgentNameDraft] = useState("");
  const [agentDescriptionDraft, setAgentDescriptionDraft] = useState("");
  const [agentEndpointDraft, setAgentEndpointDraft] = useState("");
  const [agentIdentityDraft, setAgentIdentityDraft] = useState("");

  useEffect(() => {
    const refresh = () => {
      const nextAgent = findAgent(name, agentId);
      const nextRisk = agentRiskSnapshot(name, agentId);
      const nextPolicy = getAgentVaultPolicy(name);
      const nextSessions = listAgentSessions(name).filter((item) => item.agentId === agentId);
      setAgent(nextAgent);
      setLeaderboard(agentLeaderboard(name).find((entry) => entry.agentId === agentId));
      setScorecard(listAgentScorecards(name).find((entry) => entry.agentId === agentId));
      setRisk(nextRisk);
      setEmergencyPaused(nextPolicy.emergencyPaused);
      setDailyLossCapUsd(nextPolicy.dailyLossCapUsd || "100");
      setPolicy(nextPolicy);
      setProposals(listAgentProposals(name).filter((item) => item.agentId === agentId));
      setSessions(nextSessions);
      setExecutions(listAgentExecutions(name).filter((item) => item.agentId === agentId));
      setEvents(listAgentEvents(name).filter((item) => item.agentId === agentId));
      setReadiness(
        nextAgent
          ? buildAgentTradingReadiness({
              agent: nextAgent,
              policy: nextPolicy,
              sessions: nextSessions,
              risk: nextRisk,
            })
          : null,
      );
      if (nextAgent && !editingAgent) {
        setAgentNameDraft(nextAgent.name);
        setAgentDescriptionDraft(nextAgent.description ?? "");
        setAgentEndpointDraft(nextAgent.endpoint ?? "");
        setAgentIdentityDraft(nextAgent.identityPubkey ?? "");
      }
    };
    refresh();
    return subscribeAgents(refresh);
  }, [agentId, editingAgent, name]);

  useEffect(() => {
    if (!agent) {
      setInboxSummary(null);
      return;
    }
    let cancelled = false;
    const run = async () => {
      try {
        const summary = await loadAgentInboxSummary(name, agent.id);
        if (!cancelled) setInboxSummary(summary);
      } catch {
        if (!cancelled) {
          setInboxSummary({
            count: 0,
            storage: "unknown",
            status: "unavailable",
            updatedAt: Date.now(),
          });
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [agent, name]);

  const openMarketKey = useMemo(
    () =>
      executions
        .filter((execution) => execution.status === "open")
        .map((execution) => execution.market.trim().toUpperCase())
        .filter(Boolean)
        .sort()
        .join("|"),
    [executions],
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

  const activeSessions = policy
    ? sessions.filter((session) => isAgentSessionCurrent(session, policy)).length
    : 0;
  const activeSession = policy
    ? sessions.find((session) => isAgentSessionCurrent(session, policy))
    : undefined;
  const openPositions = executions.filter((execution) => execution.status === "open").length;
  const blockedProposals = proposals.filter((proposal) => proposal.status === "blocked");
  const blockedSignals = blockedProposals.length;
  const libraryMetrics = agent
    ? agentLibraryMetrics({ agent, scorecard, executions })
    : null;
  const allocation =
    agent && policy
      ? recommendAgentAllocation({
          agent,
          scorecard,
          leaderboard,
          currentSession: activeSession,
          policy,
        })
      : null;

  const setKillSwitch = (enabled: boolean) => {
    startAction(() => {
      const updated = setAgentVaultEmergencyPause(name, enabled);
      setEmergencyPaused(updated.emergencyPaused);
      void syncAgentEmergencyPause(name, enabled).then((synced) => {
        if (synced.ok) {
          toast.success(
            enabled ? "Agent Trading paused" : "Agent Trading resumed",
          );
        } else {
          toast.info("Kill switch changed locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const setStatus = (status: AgentProfile["status"]) => {
    startAction(() => {
      const updated = updateAgentStatus(name, agentId, status);
      if (!updated) {
        toast.error("Trading agent not found");
        return;
      }
      void syncAgentProfile(updated).then((synced) => {
        if (synced.ok) {
          toast.success(
            status === "active"
              ? "Trading agent active"
              : status === "paused"
                ? "Trading agent paused"
                : "Trading agent revoked",
          );
        } else {
          toast.info("Agent status changed locally; backend sync is pending", {
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
        toast.error("Trading session not found");
        return;
      }
      void syncAgentSessionStatus(name, id, "revoked").then((synced) => {
        if (synced.ok) {
          toast.success("Trading session revoked");
        } else {
          toast.info("Session revoked locally; backend sync is pending", {
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
        toast.error("Reactivate the agent before renewing this session");
        return;
      }
      void syncAgentSession(renewed).then((synced) => {
        if (synced.ok) {
          toast.success("Trading session renewed");
        } else {
          toast.info("Session renewed locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const approveSignal = (id: string) => {
    startAction(() => {
      const updated = approveAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade signal not found");
        return;
      }
      void syncAgentProposalApproval(name, id).then((synced) => {
        if (!synced.ok) {
          toast.info("Trade signal approved locally; backend sync is pending", {
            details: synced.message,
          });
          return;
        }
        if (synced.value?.status === "blocked") {
          toast.info("Backend risk check blocked this signal", {
            details: synced.value.policyViolations?.[0]?.message,
          });
        } else {
          toast.success("Trade signal approved");
        }
      });
    });
  };

  const rejectSignal = (id: string) => {
    startAction(() => {
      const updated = rejectAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade signal not found");
        return;
      }
      void syncAgentProposalRejection(name, id).then((synced) => {
        if (synced.ok) {
          toast.success("Trade signal rejected");
        } else {
          toast.info("Trade signal rejected locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const recheckSignal = (id: string) => {
    startAction(() => {
      const result = recheckAgentProposal(name, id);
      if (!result) {
        toast.error("Trade signal not found");
        return;
      }
      if (result.execution) {
        toast.success("Trade signal passed risk and paper trade opened");
        void syncAgentExecution(result.execution).then((synced) => {
          if (!synced.ok) {
            toast.info("Paper trade opened locally; backend sync is pending", {
              details: synced.message,
            });
          }
        });
      } else if (result.proposal.status === "blocked") {
        toast.error("Trade signal is still blocked by risk limits");
      } else if (result.proposal.status === "approved") {
        toast.success("Trade signal is approved by active session");
      } else {
        toast.success("Trade signal now needs approval");
      }
    });
  };

  const openPaperTrade = (id: string) => {
    startAction(() => {
      const result = openAgentPaperTrade(name, id);
      if (result.reason === "opened") {
        toast.success("Paper trade opened");
        if (result.execution) {
          void syncAgentExecution(result.execution).then((synced) => {
            if (!synced.ok) {
              toast.info("Paper trade opened locally; backend sync is pending", {
                details: synced.message,
              });
            }
          });
        }
      } else if (result.reason === "already_open") {
        toast.success("Paper trade is already open");
      } else if (result.reason === "blocked") {
        toast.error(
          result.proposal?.policyViolations?.[0]?.message ??
            "Trade signal is blocked by risk limits",
        );
      } else if (result.reason === "backend_required") {
        toast.error("This venue needs the live trading backend before it can open trades");
      } else if (result.reason === "not_approved") {
        toast.error("Approve this trade signal first");
      } else {
        toast.error("Trade signal not found");
      }
    });
  };

  const submitVenueTrade = (id: string) => {
    startAction(() => {
      const proposal = proposals.find((item) => item.id === id);
      if (!proposal) {
        toast.error("Trade signal not found");
        return;
      }
      void submitAgentVenueExecution(proposal)
        .then((result) => {
          if (result.ok) {
            toast.success("Trade request sent to venue");
            return;
          }
          toast.error(
            result.serverRequest
              ? `${result.message} ${
                  result.duplicate ? "Request already saved." : "Request saved."
                }`
              : result.message,
          );
        })
        .catch(() => {
          toast.error("Venue setup check failed");
        });
    });
  };

  const closePaperTrade = (id: string, pnlUsd: string) => {
    startAction(() => {
      const local = closeMockAgentExecution(name, id, pnlUsd);
      const execution = executions.find((item) => item.id === id);
      const proposal = proposals.find((item) => item.id === execution?.proposalId);
      const updated = local ?? (execution
        ? closeAgentExecutionRecord({ execution, proposal, realizedPnlUsd: pnlUsd })
        : null);
      if (!updated) {
        toast.error("Paper trade not found");
        return;
      }
      if (!local) {
        setExecutions((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      }
      toast.success("Paper trade closed");
      void syncAgentExecution(updated).then((synced) => {
        if (!synced.ok) {
          toast.info("Paper trade closed locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const closeAllOpenPaperTrades = () => {
    startAction(() => {
      const localClosed = closeOpenMockAgentExecutions({
        walletName: name,
        agentId,
      });
      const localClosedIds = new Set(localClosed.map((execution) => execution.id));
      const fallbackClosed = executions
        .filter(
          (execution) =>
            execution.status === "open" && !localClosedIds.has(execution.id),
        )
        .map((execution) =>
          closeAgentExecutionRecord({
            execution,
            proposal: proposals.find((item) => item.id === execution.proposalId),
            realizedPnlUsd: "0",
          }),
        );
      const closed = [...localClosed, ...fallbackClosed];
      if (closed.length === 0) {
        toast.error("No open paper trades to close");
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
        `${closed.length} open paper trade${closed.length === 1 ? "" : "s"} closed`,
      );
      void Promise.all(closed.map((execution) => syncAgentExecution(execution))).then(
        (results) => {
          if (!results.every((result) => result.ok)) {
            toast.info("Paper trades closed locally; backend sync is pending");
          }
        },
      );
    });
  };

  const setPublished = (enabled: boolean) => {
    startAction(() => {
      const updated = enabled
        ? publishAgentProfile(name, agentId)
        : unpublishAgentProfile(name, agentId);
      if (!updated) {
        toast.error("Trading agent not found");
        return;
      }
      void syncAgentProfile(updated).then((synced) => {
        if (synced.ok) {
          toast.success(enabled ? "Agent profile published" : "Agent profile unpublished");
        } else {
          toast.info("Publishing changed locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const setPublishingModeration = (
    status: AgentModerationStatus,
    reason?: string,
  ) => {
    startAction(() => {
      const updated = moderateAgentPublishingProfile({
        walletName: name,
        id: agentId,
        status,
        reason,
      });
      if (!updated) {
        toast.error("Publish the agent profile before moderating it");
        return;
      }
      void syncAgentProfile(updated).then((synced) => {
        if (synced.ok) {
          toast.success(`Marketplace status set to ${moderationLabel(status)}`);
        } else {
          toast.info("Marketplace review changed locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  const copyPublishedProfile = () => {
    if (!agent?.publishing) return;
    const text = publishedProfileText({
      agent,
      leaderboard,
      scorecard,
      openPositions,
      libraryMetrics,
      allocation,
    });
    void navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Published profile copied"))
      .catch(() => toast.error("Could not copy published profile"));
  };

  const beginEditAgent = () => {
    if (!agent) return;
    setAgentNameDraft(agent.name);
    setAgentDescriptionDraft(agent.description ?? "");
    setAgentEndpointDraft(agent.endpoint ?? "");
    setAgentIdentityDraft(agent.identityPubkey ?? "");
    setEditingAgent(true);
  };

  const cancelEditAgent = () => {
    if (agent) {
      setAgentNameDraft(agent.name);
      setAgentDescriptionDraft(agent.description ?? "");
      setAgentEndpointDraft(agent.endpoint ?? "");
      setAgentIdentityDraft(agent.identityPubkey ?? "");
    }
    setEditingAgent(false);
  };

  const saveAgentChanges = () => {
    if (!agent) return;
    const nameDraft = agentNameDraft.trim();
    if (!nameDraft) {
      toast.error("Agent name is required");
      return;
    }
    startAction(() => {
      const updated: AgentProfile = {
        ...agent,
        name: nameDraft,
        description: cleanOptional(agentDescriptionDraft),
        endpoint: cleanOptional(agentEndpointDraft),
        identityPubkey: cleanOptional(agentIdentityDraft),
        updatedAt: Date.now(),
      };
      saveAgent(updated);
      setAgent(updated);
      setEditingAgent(false);
      void syncAgentProfile(updated).then((synced) => {
        if (synced.ok) {
          toast.success("Agent updated");
        } else {
          toast.info("Agent updated locally; backend sync is pending", {
            details: synced.message,
          });
        }
      });
    });
  };

  if (!agent) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Link
          href={`/app/wallet/${encodedWallet}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="rounded-card bg-surface-raised p-6 shadow-card-rest">
          <p className="text-sm font-semibold text-text-strong">Trading agent not found</p>
          <p className="mt-1 text-sm text-text-soft">
            This agent may have been removed from local storage.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/app/wallet/${encodedWallet}/agents`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Agent Trading
          </Link>
          <Link
            href="/privacy"
            className="inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft transition-colors hover:text-accent"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            {encrypt.live ? "Privacy on" : "Privacy ready"}
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Agent Trading · {display}
            </p>
            <h1 className="mt-1 truncate font-display text-lg leading-tight text-text-strong md:text-display-xs">
              {agent.name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={agent.status === "active" ? "success" : agent.status === "paused" ? "warning" : "danger"}>
                {agent.status}
              </Badge>
              <Badge>{agentKindLabel(agent.kind)}</Badge>
              <Badge>Trust score {leaderboard?.score ?? 50}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton
              href={
                agent.kind === "mock"
                  ? `/app/wallet/${encodedWallet}/agents/start?agent=${encodeURIComponent(agent.id)}`
                  : `/app/wallet/${encodedWallet}/agents/proposals/new?agent=${encodeURIComponent(agent.id)}`
              }
              Icon={agent.kind === "mock" ? Play : Send}
            >
              {agent.kind === "mock" ? "Start practice" : "New idea"}
            </LinkButton>
            <LinkButton href={`/app/wallet/${encodedWallet}/agents/sessions/new?agent=${encodeURIComponent(agent.id)}`} Icon={Clock}>
              Set budget
            </LinkButton>
            <LinkButton href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agent.id)}/strategy`} Icon={ShieldCheck}>
              Review style
            </LinkButton>
            {agent.kind !== "mock" ? (
              <LinkButton href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agent.id)}/connection`} Icon={Plug}>
                Connection
              </LinkButton>
            ) : null}
          </div>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Profit/loss" value={formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")} />
        <Metric label="Score" value={String(leaderboard?.score ?? 50)} />
        <Metric
          label="New ideas"
          value={
            inboxSummary?.status === "unavailable"
              ? "Offline"
              : String(inboxSummary?.count ?? 0)
          }
        />
        <Metric label="Trades" value={String(scorecard?.executed ?? 0)} />
        <Metric label="Open trades" value={String(openPositions)} />
        <Metric label="Stopped ideas" value={String(blockedSignals)} />
        <Metric label="Current budget" value={String(activeSessions)} />
        <Metric label="Today P/L" value={formatSignedUsd(risk?.dailyRealizedPnlUsd ?? "0")} />
        <Metric
          label="7-day P/L"
          value={formatSignedUsd(libraryMetrics?.sevenDayPnlUsd ?? "0")}
        />
        <Metric
          label="Win rate"
          value={
            libraryMetrics?.winRatePct == null
              ? "New"
              : `${libraryMetrics.winRatePct}%`
          }
        />
        <Metric label="Age" value={`${libraryMetrics?.ageDays ?? 0}d`} />
        <Metric
          label="Last trade"
          value={
            libraryMetrics?.lastTradedAt
              ? formatShortDate(libraryMetrics.lastTradedAt)
              : "None"
          }
        />
      </section>

      {readiness ? (
        <ReadinessPanel
          readiness={readiness}
          walletEncoded={encodedWallet}
          agentId={agent.id}
        />
      ) : null}

      {allocation && libraryMetrics ? (
        <AllowanceDecisionPanel
          recommendation={allocation}
          metrics={libraryMetrics}
          activeSession={activeSession}
          walletEncoded={encodedWallet}
          agentId={agent.id}
        />
      ) : null}

      <PublishingPanel
        agent={agent}
        walletEncoded={encodedWallet}
        pending={pending}
        onPublish={() => setPublished(true)}
        onUnpublish={() => setPublished(false)}
        onModerate={setPublishingModeration}
        onCopy={copyPublishedProfile}
      />

      <KillSwitchPanel
        paused={emergencyPaused}
        pending={pending}
        onToggle={setKillSwitch}
      />

      {inboxSummary?.count ? (
        <section className="rounded-card border border-warning/25 bg-warning/[0.08] p-4 shadow-card-rest">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/[0.12] text-warning">
                <Inbox className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-text-strong">
                  {inboxSummary.count} queued signal{inboxSummary.count === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <LinkButton
              href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agent.id)}/connection`}
              Icon={Plug}
            >
              Review inbox
            </LinkButton>
          </div>
        </section>
      ) : null}

      <section className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Trader" Icon={Bot}>
          {editingAgent ? (
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-text-soft">Name</span>
                <input
                  value={agentNameDraft}
                  onChange={(event) => setAgentNameDraft(event.target.value)}
                  className={PROFILE_INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-text-soft">Description</span>
                <textarea
                  value={agentDescriptionDraft}
                  onChange={(event) => setAgentDescriptionDraft(event.target.value)}
                  rows={3}
                  className={PROFILE_INPUT_CLASS}
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-text-soft">Connection URL</span>
                  <input
                    value={agentEndpointDraft}
                    onChange={(event) => setAgentEndpointDraft(event.target.value)}
                    className={PROFILE_INPUT_CLASS}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-text-soft">Public identity</span>
                  <input
                    value={agentIdentityDraft}
                    onChange={(event) => setAgentIdentityDraft(event.target.value)}
                    className={PROFILE_INPUT_CLASS}
                  />
                </label>
              </div>
            </div>
          ) : (
            <div className="grid gap-3 text-sm">
              <InfoRow label="Type" value={agentKindLabel(agent.kind)} />
              <InfoRow label="Status" value={agent.status} />
              <details className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
                <summary className="cursor-pointer list-none text-xs font-medium text-text-soft transition-colors hover:text-text-strong">
                  Technical details
                </summary>
                <div className="mt-2 grid gap-2">
                  <InfoRow label="Public key" value={agent.identityPubkey || "Not set"} />
                  <InfoRow label="Connection URL" value={agent.endpoint || "Not set"} />
                </div>
              </details>
              <InfoRow label="Created" value={new Date(agent.createdAt).toLocaleString()} />
              {agent.description ? (
                <div>
                  <p className="text-xs font-medium text-text-soft">Strategy notes</p>
                  <p className="mt-1 text-sm leading-relaxed text-text-strong">{agent.description}</p>
                </div>
              ) : null}
            </div>
          )}
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border-soft pt-4">
            {editingAgent ? (
              <>
                <ActionButton
                  label="Save changes"
                  Icon={Check}
                  disabled={pending}
                  onClick={saveAgentChanges}
                />
                <ActionButton
                  label="Cancel"
                  Icon={X}
                  disabled={pending}
                  onClick={cancelEditAgent}
                />
              </>
            ) : (
              <ActionButton
                label="Change agent"
                Icon={PencilLine}
                disabled={pending}
                onClick={beginEditAgent}
              />
            )}
            {!editingAgent && agent.status === "active" ? (
              <ActionButton
                label="Pause"
                Icon={Clock}
                disabled={pending}
                onClick={() => setStatus("paused")}
              />
            ) : !editingAgent && agent.status === "paused" ? (
              <ActionButton
                label="Resume"
                Icon={Check}
                disabled={pending}
                onClick={() => setStatus("active")}
              />
            ) : !editingAgent ? (
              <ActionButton
                label="Reactivate"
                Icon={RefreshCw}
                disabled={pending}
                onClick={() => setStatus("active")}
              />
            ) : null}
            {!editingAgent && agent.status !== "revoked" ? (
              <ActionButton
                label="Revoke"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => setStatus("revoked")}
              />
            ) : null}
          </div>
        </Panel>

        <Panel title="Scorecard" Icon={Trophy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <ScoreRow label="Proposals" value={scorecard?.proposals ?? 0} />
            <ScoreRow label="Approved" value={scorecard?.approved ?? 0} />
            <ScoreRow label="Rejected" value={scorecard?.rejected ?? 0} />
            <ScoreRow label="Blocked" value={scorecard?.blocked ?? 0} />
            <ScoreRow label="Rule violations" value={scorecard?.ruleViolations ?? 0} />
            <ScoreRow label="Drawdown" value={`${formatNumber(scorecard?.maxDrawdownPct ?? 0)}%`} />
            <ScoreRow label="Daily loss cap" value={`$${dailyLossCapUsd}`} />
          </div>
        </Panel>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <ScoreBreakdownPanel leaderboard={leaderboard} />
        <NextAllowancePanel
          recommendation={allocation}
          scorecard={scorecard}
          blockedProposals={blockedProposals}
        />
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <RecentTradesPanel
          executions={executions}
          marketByMarket={marketByMarket}
          pending={pending}
          onClose={closePaperTrade}
        />
        <StoppedIdeasPanel proposals={blockedProposals} />
      </section>

      <Panel title="Strategy Playbook" Icon={ShieldCheck}>
        {agent.strategy ? (
          <div className="grid gap-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge>{strategyModeLabel(agent.strategy.mode)}</Badge>
              {agent.strategy.allowedMarkets.map((market) => (
                <Badge key={market}>{market}</Badge>
              ))}
            </div>
            {agent.strategy.summary ? (
              <InfoRow label="Summary" value={agent.strategy.summary} />
            ) : null}
            <InfoRow label="Entry rules" value={agent.strategy.entryRules || "Not set"} />
            <InfoRow label="Exit rules" value={agent.strategy.exitRules || "Not set"} />
            <InfoRow label="Risk rules" value={agent.strategy.riskRules || "Not set"} />
            <InfoRow
              label="Execution protocol"
              value={agent.strategy.executionProtocol || "Not set"}
            />
            <InfoRow
              label="Kill switch"
              value={agent.strategy.killSwitchRules || "Not set"}
            />
          </div>
        ) : (
          <div className="rounded-soft border border-dashed border-border-soft bg-canvas p-4">
            <p className="text-sm font-medium text-text-strong">No strategy playbook yet</p>
            <p className="mt-1 text-sm text-text-soft">
              Add a playbook first.
            </p>
          </div>
        )}
        <div className="mt-4 border-t border-border-soft pt-4">
          <LinkButton href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agent.id)}/strategy`} Icon={ShieldCheck}>
            Edit strategy
          </LinkButton>
        </div>
      </Panel>

      <EntitySection title="Trading Sessions">
        {sessions.length > 0 ? (
          sessions.slice(0, 6).map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              policy={policy}
              pending={pending}
              onRevoke={revokeSession}
              onRenew={renewSession}
            />
          ))
        ) : (
          <EmptyLine text="No trading sessions yet." />
        )}
      </EntitySection>

      <EntitySection title="Trade Signals">
        {proposals.length > 0 ? (
          proposals.slice(0, 8).map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              pending={pending}
              onApprove={approveSignal}
              onReject={rejectSignal}
              onRecheck={recheckSignal}
              onExecute={openPaperTrade}
              onSubmitVenue={submitVenueTrade}
            />
          ))
        ) : (
          <EmptyLine text="No trade signals yet." />
        )}
      </EntitySection>

      <EntitySection title="Paper Trades">
        {openPositions > 0 ? (
          <div className="rounded-soft border border-rose-500/25 bg-rose-500/[0.08] px-3 py-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-medium text-text-strong">
                {openPositions} open paper position{openPositions === 1 ? "" : "s"}
              </p>
              <ActionButton
                label="Close all open"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={closeAllOpenPaperTrades}
              />
            </div>
          </div>
        ) : null}
        {executions.length > 0 ? (
          executions.slice(0, 8).map((execution) => (
            <ExecutionRow
              key={execution.id}
              execution={execution}
              marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
              pending={pending}
              onClose={closePaperTrade}
            />
          ))
        ) : (
          <EmptyLine text="No paper trades yet." />
        )}
      </EntitySection>

      <EntitySection title="Agent Log">
        {events.length > 0 ? (
          events.slice(0, 10).map((event) => (
            <div
              key={event.id}
              className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 shadow-card-rest"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-strong">{event.message}</p>
                <span className="text-[11px] text-text-soft">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))
        ) : (
          <EmptyLine text="No agent activity yet." />
        )}
      </EntitySection>
    </div>
  );
}

function Panel({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Bot;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface-raised p-3 shadow-card-rest">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function ReadinessPanel({
  readiness,
  walletEncoded,
  agentId,
}: {
  readiness: AgentTradingReadiness;
  walletEncoded: string;
  agentId: string;
}) {
  return (
    <section
      id="publishing"
      className="rounded-card bg-surface-raised p-4 shadow-card-rest"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              readiness.status === "ready"
                ? "bg-accent/10 text-accent"
                : readiness.status === "blocked"
                  ? "bg-rose-500/[0.08] text-rose-300"
                  : "bg-warning/[0.08] text-warning",
            )}
          >
            {readiness.status === "ready" ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Ready to trade
              </h2>
              <Badge tone={readinessBadgeTone(readiness.status)}>
                {readiness.score}% · {readiness.headline}
              </Badge>
            </div>
          </div>
        </div>
        <LinkButton
          href={readinessHref(walletEncoded, agentId, readiness.primaryAction)}
          Icon={ArrowRight}
        >
          {readinessActionLabel(readiness.primaryAction)}
        </LinkButton>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {readiness.items.map((item) => (
          <div
            key={item.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  item.status === "pass"
                    ? "bg-accent"
                    : item.status === "block"
                      ? "bg-rose-400"
                      : "bg-warning",
                )}
              />
              <p className="text-xs font-semibold text-text-strong">{item.label}</p>
              <Badge tone={item.status === "pass" ? "success" : item.status === "block" ? "danger" : "warning"}>
                {item.status === "pass" ? "Ready" : item.status === "block" ? "Blocked" : "Setup"}
              </Badge>
            </div>
            <details className="group mt-1">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-text-soft transition-colors hover:text-accent">
                Why
                <ArrowRight
                  className="h-3 w-3 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-1.5 text-xs leading-relaxed text-text-soft">
                {item.message}
              </p>
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}

function AllowanceDecisionPanel({
  recommendation,
  metrics,
  activeSession,
  walletEncoded,
  agentId,
}: {
  recommendation: AgentAllocationRecommendation;
  metrics: AgentLibraryMetrics;
  activeSession?: AgentSessionGrant;
  walletEncoded: string;
  agentId: string;
}) {
  const startHref = activeSession
    ? `/app/wallet/${walletEncoded}/agents/start?agent=${encodeURIComponent(agentId)}`
    : `/app/wallet/${walletEncoded}/agents/sessions/new?agent=${encodeURIComponent(agentId)}`;
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Trophy className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Suggested budget
              </h2>
              <Badge tone={allocationBadgeTone(recommendation.action)}>
                {allocationActionLabel(recommendation.action)}
              </Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              {plainAllowanceSummary(recommendation)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <LinkButton href={startHref} Icon={activeSession ? Play : Clock}>
            {activeSession ? "Start practice" : "Set budget"}
          </LinkButton>
          <LinkButton href={`/app/wallet/${walletEncoded}/agents/library`} Icon={Trophy}>
            Explore traders
          </LinkButton>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreRow label="Budget level" value={recommendation.tier.label} />
        <ScoreRow
          label="Trade size"
          value={formatUsd(recommendation.limits.maxNotionalUsd)}
        />
        <ScoreRow label="Open trades" value={recommendation.limits.maxOpenPositions} />
        <ScoreRow label="Time window" value={`${recommendation.limits.sessionHours}h`} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-text-strong">Why this budget?</p>
          <ul className="mt-2 grid gap-1.5">
            {recommendation.reasons.slice(0, 5).map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-xs text-text-soft">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                <span>{plainMetricText(reason)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-strong">Recent proof</p>
          <div className="mt-2 grid gap-1.5 text-xs text-text-soft">
            <span>7-day profit/loss: {formatSignedUsd(metrics.sevenDayPnlUsd)}</span>
            <span>
              Win rate: {metrics.winRatePct == null ? "not enough trades yet" : `${metrics.winRatePct}%`}
            </span>
            <span>Completed trades: {metrics.closedTrades}</span>
            <span>Open trades now: {metrics.openTrades}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function PublishingPanel({
  agent,
  walletEncoded,
  pending,
  onPublish,
  onUnpublish,
  onModerate,
  onCopy,
}: {
  agent: AgentProfile;
  walletEncoded: string;
  pending: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onModerate: (status: AgentModerationStatus, reason?: string) => void;
  onCopy: () => void;
}) {
  const published = agent.publishing?.status === "published";
  const moderation = agent.publishing?.moderation;
  const slug = agent.publishing?.slug ?? "not-published";
  const previewHref = publicProfileUrl(
    decodeParam(walletEncoded),
    agent.publishing?.slug ?? agent.id,
  );
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              published ? "bg-accent/10 text-accent" : "bg-canvas text-text-soft",
            )}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Agent publishing
              </h2>
              <Badge tone={published ? "success" : "default"}>
                {published ? "Published" : "Draft"}
              </Badge>
              {published ? (
                <Badge tone={moderationBadgeTone(moderation?.status)}>
                  {moderationLabel(moderation?.status ?? "pending_review")}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {published ? (
            <>
              <ActionButton
                label="Copy profile"
                Icon={Copy}
                disabled={pending}
                onClick={onCopy}
              />
              <ActionButton
                label="Approve"
                Icon={ShieldCheck}
                disabled={pending}
                onClick={() =>
                  onModerate("approved", "Profile passed marketplace review.")
                }
              />
              <ActionButton
                label="Review"
                Icon={Clock}
                disabled={pending}
                onClick={() =>
                  onModerate(
                    "pending_review",
                    "Profile is waiting for marketplace review.",
                  )
                }
              />
              <ActionButton
                label="Pause listing"
                Icon={AlertTriangle}
                disabled={pending}
                onClick={() =>
                  onModerate(
                    "paused",
                    "Profile is paused while ClearSig reviews recent behavior.",
                  )
                }
              />
              <ActionButton
                label="Delist"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() =>
                  onModerate("delisted", "Profile is hidden from marketplace discovery.")
                }
              />
              <ActionButton
                label="Unpublish"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={onUnpublish}
              />
            </>
          ) : (
            <ActionButton
              label="Publish"
              Icon={Globe}
              disabled={pending}
              onClick={onPublish}
            />
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <ScoreRow label="Profile slug" value={slug} />
        <ScoreRow
          label="Visible metrics"
          value={published ? String(agent.publishing?.visibleMetrics.length ?? 0) : "None"}
        />
        <ScoreRow
          label="Marketplace review"
          value={published ? moderationLabel(moderation?.status ?? "pending_review") : "Not published"}
        />
        <ScoreRow
          label="Preview"
          value={published ? previewHref : "Publish first"}
        />
      </div>
      {published ? (
        <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
          <p className="text-xs leading-relaxed text-text-soft">
            Published {formatShortDate(agent.publishing?.publishedAt ?? Date.now())}.
            Current testing link: {previewHref}
          </p>
          {moderation?.reason ? (
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Review note: {moderation.reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ScoreBreakdownPanel({
  leaderboard,
}: {
  leaderboard?: AgentLeaderboardEntry;
}) {
  const inputs = leaderboard?.rankInputs;
  const rows = [
    { label: "Profit score", value: inputs?.returnScore ?? 50 },
    { label: "Safety score", value: inputs?.complianceScore ?? 50 },
    { label: "Largest fall score", value: inputs?.drawdownScore ?? 50 },
    { label: "Follow-through score", value: inputs?.executionScore ?? 50 },
    { label: "Manual change penalty", value: inputs?.trustPenalty ?? 0 },
  ];
  return (
    <Panel title="Score Breakdown" Icon={Trophy}>
      <div className="grid gap-2">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="font-medium text-text-soft">{row.label}</span>
              <span className="font-semibold text-text-strong">{formatNumber(row.value)}</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-canvas">
              <div
                className={clsx(
                  "h-full rounded-full",
                  row.label.includes("penalty") ? "bg-warning" : "bg-accent",
                )}
                style={{ width: `${Math.min(100, Math.max(0, row.value))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function NextAllowancePanel({
  recommendation,
  scorecard,
  blockedProposals,
}: {
  recommendation: AgentAllocationRecommendation | null;
  scorecard?: AgentScorecard;
  blockedProposals: AgentTradeProposal[];
}) {
  const gaps = recommendation?.nextTierGaps ?? [];
  const suggestions = gaps.length > 0 ? gaps.map(plainMetricText) : [];
  if ((scorecard?.blocked ?? 0) > 0) {
    suggestions.push("Fewer stopped ideas will make the next budget easier to approve.");
  }
  if ((scorecard?.executed ?? 0) === 0) {
    suggestions.push("Complete a few small guarded trades first.");
  }
  return (
    <Panel title="Next Budget" Icon={ShieldCheck}>
      {recommendation?.nextTier ? (
        <p className="text-sm text-text-soft">
          Next level:{" "}
          <span className="font-semibold text-text-strong">
            {recommendation.nextTier.label}
          </span>
        </p>
      ) : (
        <p className="text-sm text-text-soft">
          Highest budget level.
        </p>
      )}
      <div className="mt-3 grid gap-2">
        {suggestions.length > 0 ? (
          suggestions.slice(0, 5).map((item) => (
            <div
              key={item}
              className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs leading-relaxed text-text-soft"
            >
              {item}
            </div>
          ))
        ) : (
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2 text-xs text-text-soft">
            Keep the same performance while trading a little longer.
          </div>
        )}
      </div>
      {blockedProposals[0] ? (
        <p className="mt-3 text-xs leading-relaxed text-text-soft">
          Latest stopped idea: {blockedProposals[0].market} {blockedProposals[0].side}
          {blockedProposals[0].policyViolations?.[0]?.message
            ? ` â€” ${blockedProposals[0].policyViolations[0].message}`
            : ""}
        </p>
      ) : null}
    </Panel>
  );
}

function RecentTradesPanel({
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
  return (
    <Panel title="Recent Trade History" Icon={Clock}>
      <div className="grid gap-2">
        {executions.length > 0 ? (
          executions.slice(0, 4).map((execution) => (
            <ExecutionRow
              key={execution.id}
              execution={execution}
              marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
              pending={pending}
              onClose={onClose}
            />
          ))
        ) : (
          <EmptyLine text="No trades yet." />
        )}
      </div>
    </Panel>
  );
}

function StoppedIdeasPanel({
  proposals,
}: {
  proposals: AgentTradeProposal[];
}) {
  return (
    <Panel title="Stopped Ideas" Icon={AlertTriangle}>
      <div className="grid gap-2">
        {proposals.length > 0 ? (
          proposals.slice(0, 4).map((proposal) => (
            <div
              key={proposal.id}
              className="rounded-soft border border-rose-500/25 bg-rose-500/[0.06] px-3 py-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-text-strong">
                  {proposal.market} · {proposal.side}
                </p>
                <Badge tone="danger">Stopped</Badge>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">
                {proposal.policyViolations?.[0]?.message ??
                  "This idea was outside the current budget."}
              </p>
            </div>
          ))
        ) : (
          <EmptyLine text="No stopped ideas yet." />
        )}
      </div>
    </Panel>
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
        "rounded-card p-4 shadow-card-rest",
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
              {paused ? "Agent Trading is paused" : "Agent Trading is armed"}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              {paused
                ? "The kill switch is on. New agent signals cannot open paper trades."
                : "Use the kill switch to stop all agent trading immediately."}
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
          {paused ? "Resume agent trading" : "Pause all agents"}
        </button>
      </div>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-soft">{label}</p>
      <p className="mt-1 break-words text-sm text-text-strong">{value}</p>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-xs font-medium text-text-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function EntitySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function SessionRow({
  session,
  policy,
  pending,
  onRevoke,
  onRenew,
}: {
  session: AgentSessionGrant;
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
  const status = active
    ? "Active"
    : stale
      ? "Needs renewal"
    : session.status === "active" && session.expiresAt <= Date.now()
      ? "Expired"
      : capitalize(session.status);
  return (
    <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">{status} session</p>
            <Badge tone={active ? "success" : stale ? "warning" : "default"}>
              {status}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {session.allowedMarkets?.join(", ") || "Allowed markets"} · ${session.maxNotionalUsd ?? "limit"} ·{" "}
            {session.maxLeverage ?? "limit"}x
          </p>
          <p className="mt-2 text-[11px] text-text-soft">
            {stale
              ? "Risk limits changed after this session was issued."
              : `Expires ${new Date(session.expiresAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active ? (
            <ActionButton
              label="Revoke session"
              Icon={X}
              disabled={pending}
              tone="danger"
              onClick={() => onRevoke(session.id)}
            />
          ) : (
            <ActionButton
              label="Renew session"
              Icon={RefreshCw}
              disabled={pending}
              onClick={() => onRenew(session.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ProposalRow({
  proposal,
  pending,
  onApprove,
  onReject,
  onRecheck,
  onExecute,
  onSubmitVenue,
}: {
  proposal: AgentTradeProposal;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRecheck: (id: string) => void;
  onExecute: (id: string) => void;
  onSubmitVenue: (id: string) => void;
}) {
  return (
    <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {proposal.market} · {proposal.side}
            </p>
            <Badge tone={proposal.status === "blocked" ? "danger" : proposal.status === "executed" ? "success" : "default"}>
              {proposalStatusLabel(proposal.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {venueLabel(proposal.venue)} · ${proposal.notionalUsd} · {proposal.leverage}x · Confidence{" "}
            {proposal.confidence}%
          </p>
          {proposal.policyViolations?.[0] ? (
            <p className="mt-2 text-xs leading-relaxed text-rose-300">
              {proposal.policyViolations[0].message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {proposal.status === "blocked" ? (
            <ActionButton
              label="Recheck risk"
              Icon={RefreshCw}
              disabled={pending}
              onClick={() => onRecheck(proposal.id)}
            />
          ) : null}
          {proposal.status === "needs_approval" ? (
            <>
              <ActionButton
                label="Approve"
                Icon={Check}
                disabled={pending}
                onClick={() => onApprove(proposal.id)}
              />
              <ActionButton
                label="Reject"
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
                label="Open paper trade"
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
      </div>
    </div>
  );
}

function ExecutionRow({
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
  const open = execution.status === "open";
  const pnl = Number(execution.realizedPnlUsd || 0);
  const performance = estimateAgentOpenTradePerformance(execution, marketSnapshot);
  return (
    <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {execution.market} · {execution.side}
            </p>
            <Badge tone={open ? "success" : "default"}>{open ? "Open" : "Closed"}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {venueLabel(execution.venue)} · ${execution.notionalUsd} · {execution.leverage}x
          </p>
          {open ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ScoreRow label="Entry" value={formatUsd(execution.entryPrice ?? "0")} />
              <ScoreRow
                label="Mark"
                value={performance ? formatUsd(performance.markPriceUsd) : "Waiting"}
              />
              <ScoreRow
                label="Est. P/L"
                value={performance ? formatSignedUsd(performance.unrealizedPnlUsd) : "Unknown"}
              />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-text-soft">
            <span>Opened {new Date(execution.openedAt).toLocaleString()}</span>
            {!open ? (
              <span className={clsx("font-medium", pnl > 0 ? "text-accent" : pnl < 0 ? "text-rose-300" : "text-text-soft")}>
                PnL {formatSignedUsd(execution.realizedPnlUsd)}
              </span>
            ) : null}
          </div>
        </div>
        {open ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={pnlUsd}
              onChange={(event) => setPnlUsd(event.target.value)}
              inputMode="decimal"
              placeholder="PnL USD"
              className="min-h-8 w-28 rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs text-text-strong placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
            <ActionButton
              label="Close position"
              Icon={X}
              disabled={pending}
              onClick={() => onClose(execution.id, pnlUsd || performance?.unrealizedPnlUsd || "0")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LinkButton({
  href,
  Icon,
  children,
}: {
  href: string;
  Icon: typeof Send;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest transition-colors hover:border-accent/60 hover:text-accent"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </Link>
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
        "transition-colors duration-base ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-not-allowed disabled:opacity-60",
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

function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
        tone === "success"
          ? "border-accent/30 bg-accent/[0.08] text-accent"
          : tone === "warning"
            ? "border-warning/30 bg-warning/[0.08] text-warning"
            : tone === "danger"
              ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-500"
              : "border-border-soft bg-canvas text-text-soft",
      )}
    >
      {children}
    </span>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-card bg-surface-raised p-4 text-sm text-text-soft">
      {text}
    </div>
  );
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function agentKindLabel(kind: AgentKind): string {
  switch (kind) {
    case "mock":
      return "Paper agent";
    case "api":
      return "API agent";
    case "hermes":
      return "Autonomous agent";
    case "manual":
      return "Manual trader";
  }
}

function proposalStatusLabel(status: AgentProposalStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "blocked":
      return "Blocked";
    case "needs_approval":
      return "Needs approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "executed":
      return "Opened";
    case "expired":
      return "Expired";
  }
}

function venueLabel(venue: TradingVenue): string {
  switch (venue) {
    case "mock_perps":
      return "Built-in practice";
    case "hyperliquid_testnet":
      return "Connected practice";
    case "bulktrade_mock":
      return "Bulk practice";
  }
}

function readinessBadgeTone(
  status: AgentTradingReadiness["status"],
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "ready":
      return "success";
    case "blocked":
      return "danger";
    case "needs_setup":
      return "warning";
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
      return "Set max loss";
    case "strategy":
      return "Review style";
    case "session":
      return "Set budget";
    case "agent":
      return "Details";
    case "none":
      return "Details";
  }
}

function strategyModeLabel(mode: AgentTradingMode): string {
  switch (mode) {
    case "read_only":
      return "Read-only";
    case "paper":
      return "Paper trading";
    case "bounded_live":
      return "Bounded live";
    default:
      return "Strategy";
  }
}

function allocationBadgeTone(
  action: AgentAllocationRecommendation["action"],
): "default" | "success" | "warning" | "danger" {
  switch (action) {
    case "promote":
      return "success";
    case "demote":
      return "danger";
    case "review":
      return "warning";
    case "hold":
    case "start":
      return "default";
  }
}

function allocationActionLabel(
  action: AgentAllocationRecommendation["action"],
): string {
  switch (action) {
    case "promote":
      return "Raise budget";
    case "demote":
      return "Lower budget";
    case "hold":
      return "Keep budget";
    case "review":
      return "Review first";
    case "start":
      return "Start small";
  }
}

function moderationLabel(status: AgentModerationStatus): string {
  switch (status) {
    case "pending_review":
      return "Pending review";
    case "approved":
      return "Approved";
    case "paused":
      return "Paused";
    case "delisted":
      return "Delisted";
  }
}

function moderationBadgeTone(
  status: AgentModerationStatus | undefined,
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "approved":
      return "success";
    case "delisted":
      return "danger";
    case "paused":
    case "pending_review":
    case undefined:
      return "warning";
  }
}

function plainAllowanceSummary(
  recommendation: AgentAllocationRecommendation,
): string {
  const limits = recommendation.limits;
  const size = formatUsd(limits.maxNotionalUsd);
  const openTrades = `${limits.maxOpenPositions} open trade${
    limits.maxOpenPositions === 1 ? "" : "s"
  }`;
  const window = `${limits.sessionHours} hour${
    limits.sessionHours === 1 ? "" : "s"
  }`;
  const core = `${recommendation.tier.label}: up to ${size} per trade, ${limits.maxLeverage}x, ${openTrades}, for ${window}.`;
  switch (recommendation.action) {
    case "promote":
      return `This trader has earned a larger budget. ${core}`;
    case "demote":
      return `This trader should use a smaller budget next. ${core}`;
    case "hold":
      return `The current budget still fits this trader. ${core}`;
    case "review":
      return `Review the setup before giving more control. ${core}`;
    case "start":
      return `Start with a small human-approved budget. ${core}`;
  }
}

function plainMetricText(value: string): string {
  return value
    .replace("executed trades", "completed trades")
    .replace("more executed trades", "more completed trades")
    .replace("trust score", "score")
    .replace("maximum drawdown", "largest fall")
    .replace("drawdown", "largest fall")
    .replace("violation rate", "stopped-idea rate")
    .replace("rule violations", "stopped ideas")
    .replace("human overrides", "manual changes")
    .replace("positive realized PnL", "positive profit/loss")
    .replace("PnL", "profit/loss");
}

function publishedProfileText({
  agent,
  leaderboard,
  scorecard,
  openPositions,
  libraryMetrics,
  allocation,
}: {
  agent: AgentProfile;
  leaderboard?: AgentLeaderboardEntry;
  scorecard?: AgentScorecard;
  openPositions: number;
  libraryMetrics: AgentLibraryMetrics | null;
  allocation: AgentAllocationRecommendation | null;
}): string {
  const publishing = agent.publishing;
  return [
    `${agent.name} by ClearSig`,
    publishing?.publicSummary ?? agent.description ?? "Published agent profile",
    "",
    `Profile: ${publicProfileUrl(agent.walletName, publishing?.slug ?? agent.id)}`,
    `Status: ${agent.status}`,
    `Marketplace review: ${moderationLabel(publishing?.moderation?.status ?? "pending_review")}`,
    `Score: ${leaderboard?.score ?? 50}`,
    `Profit/loss: ${formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")}`,
    `Closed trades: ${libraryMetrics?.closedTrades ?? 0}`,
    `Open trades: ${openPositions}`,
    `Win rate: ${
      libraryMetrics?.winRatePct == null ? "New" : `${libraryMetrics.winRatePct}%`
    }`,
    `Safety stops: ${scorecard?.ruleViolations ?? 0}`,
    `Budget level: ${allocation?.tier.label ?? "Probation"}`,
  ].join("\n");
}

function cleanOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
}

function formatShortDate(value: number): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}

const PROFILE_INPUT_CLASS =
  "min-h-10 w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";
