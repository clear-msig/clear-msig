"use client";

import { useToast } from "@/components/ui/Toast";
import type { AgentAutomaticExitDecision } from "@/features/agents/domain/runtime";
import { type AgentExecutionRecord, type AgentProfile, type AgentScoutReport, type AgentSessionGrant, type AgentTradeProposal, type AgentVaultPolicy, buildAgentScoutProposal, canOpenLocalAgentExecution, closeAgentExecutionRecord, isAgentSessionCurrent } from "@/features/agents/domain/runtime";
import { type AgentKillSwitchHandoff, syncAgentEmergencyPause, syncAgentExecution, syncAgentProfile, syncAgentProposal, syncAgentProposalApproval, syncAgentProposalRejection, syncAgentSession, syncAgentSessionStatus } from "@/features/agents/infrastructure/stateClient";
import { type AgentVenueReadiness, submitAgentVenueExecution } from "@/features/agents/infrastructure/executionClient";
import { agentRiskSnapshot, approveAgentProposal, closeMockAgentExecution, closeOpenMockAgentExecutions, newAgentProposalId, openAgentPaperTrade, recheckAgentProposal, rejectAgentProposal, renewAgentSession, saveAgentProposal, saveAgentProposalAndExecuteIfAllowed, setAgentVaultEmergencyPause, updateAgentSessionStatus, updateAgentStatus } from "@/features/agents/infrastructure/agentStore";
import { useAgentTypedClearSignApproval } from "@/features/agents/infrastructure/typedApprovalClient";
import type { Dispatch, SetStateAction, TransitionStartFunction } from "react";

interface DashboardActionContext {
  agents: AgentProfile[];
  approveTypedAgentClearSign: ReturnType<typeof useAgentTypedClearSignApproval>;
  automaticExitDecisions: AgentAutomaticExitDecision[];
  encoded: string;
  executions: AgentExecutionRecord[];
  name: string;
  openExecutionRecords: AgentExecutionRecord[];
  policy: AgentVaultPolicy | null;
  proposals: AgentTradeProposal[];
  refreshBackendState: () => Promise<void>;
  router: { push(href: string): void };
  sessions: AgentSessionGrant[];
  setExecutions: Dispatch<SetStateAction<AgentExecutionRecord[]>>;
  setKillSwitchHandoff: Dispatch<SetStateAction<AgentKillSwitchHandoff | null>>;
  setLiveVenueReadiness: Dispatch<SetStateAction<AgentVenueReadiness | null>>;
  setPolicy: Dispatch<SetStateAction<AgentVaultPolicy | null>>;
  startAction: TransitionStartFunction;
  toast: ReturnType<typeof useToast>;
}

export function useAgentDashboardActions({
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
}: DashboardActionContext) {
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
      void import("@/features/agents/infrastructure/autonomyClient")
        .then(({ runAgentAutonomyTickClient }) =>
          runAgentAutonomyTickClient({
            walletName: name,
            venue: "hyperliquid_testnet",
            maxMarkets: 80,
            maxIdeas: 3,
          }),
        )
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
    startAction(async () => {
      try {
        const { setupAgentBetaDemo } = await import(
          "@/features/agents/infrastructure/demoClient"
        );
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
      void (async () => {
        const proposal = proposals.find((item) => item.id === id);
        if (!proposal) {
          toast.error("Trade idea not found");
          return;
        }
        let typedResult: Awaited<ReturnType<typeof approveTypedAgentClearSign>>;
        try {
          typedResult = await approveTypedAgentClearSign({
            ...proposal,
            status: "approved",
            updatedAt: Date.now(),
          });
        } catch (err) {
          toast.error("ClearSign approval did not reach chain", {
            details: err instanceof Error ? err.message : String(err),
          });
          return;
        }
        const updated = approveAgentProposal(name, id);
        if (!updated) {
          toast.error("Trade idea not found");
          return;
        }
        saveAgentProposal({
          ...updated,
          clearSignV2: typedResult.proposal.clearSignV2,
        });
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
            toast.success(
              typedResult.status === "executed"
                ? "Agent approval verified on chain"
                : "Agent approval is waiting on chain",
            );
          }
          void refreshBackendState();
        });
      })();
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
  return {
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
  };
}
