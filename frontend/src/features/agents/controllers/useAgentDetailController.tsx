"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import { type AgentAuditEvent, type AgentExecutionRecord, type AgentLeaderboardEntry, agentLibraryMetrics, type AgentMarketDataSnapshot, type AgentModerationStatus, type AgentProfile, type AgentRiskSnapshot, type AgentScorecard, type AgentSessionGrant, type AgentTradeProposal, type AgentTradingReadiness, type AgentVaultPolicy, buildAgentTradingReadiness, closeAgentExecutionRecord, isAgentSessionCurrent, recommendAgentAllocation } from "@/features/agents/domain/runtime";
import { type AgentInboxSummary, loadAgentInboxSummary } from "@/features/agents/infrastructure/inboxClient";
import { syncAgentEmergencyPause, syncAgentExecution, syncAgentProfile, syncAgentProposalApproval, syncAgentProposalRejection, syncAgentSession, syncAgentSessionStatus } from "@/features/agents/infrastructure/stateClient";
import { submitAgentVenueExecution } from "@/features/agents/infrastructure/executionClient";
import { agentLeaderboard, agentRiskSnapshot, approveAgentProposal, closeMockAgentExecution, closeOpenMockAgentExecutions, findAgent, getAgentVaultPolicy, listAgentEvents, listAgentExecutions, listAgentProposals, listAgentScorecards, listAgentSessions, moderateAgentPublishingProfile, openAgentPaperTrade, publishAgentProfile, recheckAgentProposal, rejectAgentProposal, renewAgentSession, saveAgent, setAgentVaultEmergencyPause, subscribeAgents, unpublishAgentProfile, updateAgentSessionStatus, updateAgentStatus } from "@/features/agents/infrastructure/agentStore";
import { loadAgentMarketDataSnapshots } from "@/features/agents/infrastructure/marketDataClient";
import { toDisplayName } from "@/lib/retail/walletNames";
import { cleanOptional, decodeParam, moderationLabel, publishedProfileText } from "@/features/agents/ui/detail/presentation";

export function useAgentDetailController() {
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
              ? `${result.message} ${result.duplicate ? "Request already saved." : "Request saved."
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
    return {
      notFound: (
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
      )
    };
  }
  return {
    activeSession,
    activeSessions,
    agent,
    agentDescriptionDraft,
    agentEndpointDraft,
    agentId,
    agentIdentityDraft,
    agentNameDraft,
    allocation,
    approveSignal,
    beginEditAgent,
    blockedProposals,
    blockedSignals,
    cancelEditAgent,
    closeAllOpenPaperTrades,
    closePaperTrade,
    copyPublishedProfile,
    dailyLossCapUsd,
    display,
    editingAgent,
    emergencyPaused,
    encodedWallet,
    encrypt,
    events,
    executions,
    inboxSummary,
    leaderboard,
    libraryMetrics,
    marketByMarket,
    name,
    openPaperTrade,
    openPositions,
    pending,
    policy,
    proposals,
    readiness,
    recheckSignal,
    rejectSignal,
    renewSession,
    revokeSession,
    risk,
    saveAgentChanges,
    scorecard,
    sessions,
    setAgentDescriptionDraft,
    setAgentEndpointDraft,
    setAgentIdentityDraft,
    setAgentNameDraft,
    setKillSwitch,
    setPublished,
    setPublishingModeration,
    setStatus,
    submitVenueTrade,
  };
}
