"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useToast } from "@/components/ui/Toast";
import { acknowledgeAgentComplianceDisclosures, type AgentAuditEvent, type AgentConnectionKit, type AgentExecutionRecord, type AgentMarketDataSnapshot, type AgentOwnerApproval, type AgentOwnerApprovalInput, type AgentProfile, type AgentSessionGrant, type AgentTradeProposal, type AgentTradingReadiness, type AgentVaultPolicy, buildAgentComplianceReadiness, buildAgentTradeDecisionJournal, buildAgentTradeLifecycle, buildAgentTradingReadiness, buildTradingLaunchState, closeAgentExecutionRecord, createBrowserOwnerApproval, createClearSigLibraryPracticeIdea, evaluateAgentTradeProposal, isAgentSessionCurrent, ownerApprovalSignableText, summarizeAgentTradeLifecycles, type TradingLaunchVenue } from "@/features/agents/domain/runtime";
import { type AgentInboxSummary, loadAgentConnectionKit, loadAgentInboxSummary, setAgentAutomaticTrading } from "@/features/agents/infrastructure/inboxClient";
import { type AgentKillSwitchHandoff, type AgentServerWalletState, loadAgentBackendState, syncAgentEmergencyPause, syncAgentExecution, syncAgentOwnerApproval, syncAgentProfile, syncAgentProposal } from "@/features/agents/infrastructure/stateClient";
import { type AgentVenueReadiness, loadAgentVenueReadiness, startAgentVenueReadinessPolling, submitAgentVenueExecution } from "@/features/agents/infrastructure/executionClient";
import { agentRiskSnapshot, closeMockAgentExecution, closeOpenMockAgentExecutions, getAgentConnectionKit, getAgentVaultPolicy, listAgentEvents, listAgentExecutions, listAgentProposals, listAgents, listAgentSessions, newAgentProposalId, saveAgentOwnerApproval, saveAgentProposal, saveAgentProposalAndExecuteIfAllowed, setAgentVaultEmergencyPause, updateAgentStatus } from "@/features/agents/infrastructure/agentStore";
import { getAgentHyperliquidSetupSettings } from "@/features/agents/infrastructure/hyperliquidSettings";
import { loadAgentMarketDataSnapshots } from "@/features/agents/infrastructure/marketDataClient";
import { decryptAgentVaultPolicy } from "@/features/agents/infrastructure/vaultCrypto";
import { useSignWithWallet } from "@/features/agents/infrastructure/walletSigningClient";
import { toDisplayName } from "@/lib/retail/walletNames";
import { decodeParam, formatSignedUsd, formatUsd, loadStartMarketData, mergeById, sessionAllowsVenue, venueLabel } from "@/features/agents/ui/start/presentation";

export function useStartTradingController() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();
  const toast = useToast();
  const { canSign, signLocalClearText } = useSignWithWallet();
  const [pending, startTransition] = useTransition();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const display = toDisplayName(name);
  const encoded = encodeURIComponent(name);
  const requestedAgent = search.get("agent")?.trim() ?? "";
  const requestedVenue =
    search.get("venue") === "hyperliquid_testnet"
      ? "hyperliquid_testnet"
      : "mock_perps";
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [decryptedPolicy, setDecryptedPolicy] = useState<AgentVaultPolicy | null>(null);
  const [agentId, setAgentId] = useState(requestedAgent);
  const [venue, setVenue] = useState<TradingLaunchVenue>(requestedVenue);
  const [readiness, setReadiness] = useState<AgentTradingReadiness | null>(null);
  const [inbox, setInbox] = useState<AgentInboxSummary | null>(null);
  const [outside, setOutside] = useState<AgentVenueReadiness | null>(null);
  const [savedState, setSavedState] = useState<AgentServerWalletState | null>(null);
  const [connectionKit, setConnectionKit] = useState<AgentConnectionKit | null>(null);
  const [marketSnapshot, setMarketSnapshot] = useState<AgentMarketDataSnapshot | null>(null);
  const [marketByMarket, setMarketByMarket] = useState<Record<string, AgentMarketDataSnapshot>>({});
  const [marketStatus, setMarketStatus] = useState("Checking market data");
  const [approvalRequest, setApprovalRequest] = useState<AgentOwnerApprovalInput | null>(null);
  const [approvalApproveLabel, setApprovalApproveLabel] = useState("Approve");
  const [approvalMode, setApprovalMode] = useState<"wallet" | "browser" | null>(null);
  const [approvalBusy, setApprovalBusy] = useState(false);
  const [automaticTradingBusy, setAutomaticTradingBusy] = useState(false);
  const [killSwitchHandoff, setKillSwitchHandoff] =
    useState<AgentKillSwitchHandoff | null>(null);
  const [disclosureRefresh, setDisclosureRefresh] = useState(0);
  const approvalResolver = useRef<((approval: AgentOwnerApproval | null) => void) | null>(null);
  const [loading, setLoading] = useState(true);
  const selectedAgent = agents.find((agent) => agent.id === agentId) ?? null;
  const refresh = useCallback(async () => {
    const nextAgents = listAgents(name);
    const selected =
      nextAgents.find((agent) => agent.id === agentId) ??
      nextAgents.find((agent) => agent.id === requestedAgent) ??
      nextAgents[0] ??
      null;
    setAgents(nextAgents);
    if (selected && selected.id !== agentId) setAgentId(selected.id);

    const policy = await decryptAgentVaultPolicy(getAgentVaultPolicy(name));
    setDecryptedPolicy(policy);
    const sessions = listAgentSessions(name);
    setReadiness(
      selected
        ? buildAgentTradingReadiness({
          agent: selected,
          policy,
          sessions: sessions.filter((session) => session.agentId === selected.id),
          risk: agentRiskSnapshot(name, selected.id),
        })
        : null,
    );

    const [nextConnectionKit, nextInbox, nextOutside, nextSavedState, nextMarket] = await Promise.all([
      selected
        ? loadAgentConnectionKit(name, selected.id).catch(() => getAgentConnectionKit(name, selected.id))
        : Promise.resolve(null),
      selected
        ? loadAgentInboxSummary(name, selected.id).catch(() => null)
        : Promise.resolve(null),
      selected && venue === "hyperliquid_testnet"
        ? loadAgentVenueReadiness("hyperliquid_testnet", {
          walletName: name,
          agentId: selected.id,
          accountAddress: getAgentHyperliquidSetupSettings(name).accountAddress,
        }).catch(() => null)
        : Promise.resolve(null),
      loadAgentBackendState(name).catch(() => null),
      selected
        ? loadStartMarketData({
          agent: selected,
          venue,
        })
        : Promise.resolve({ snapshot: null, message: "Choose a trader first" }),
    ]);
    setConnectionKit(nextConnectionKit);
    setInbox(nextInbox);
    setOutside(nextOutside);
    setSavedState(
      nextSavedState?.ok && nextSavedState.value
        ? nextSavedState.value.state
        : null,
    );
    setMarketSnapshot(nextMarket.snapshot);
    setMarketStatus(nextMarket.message);
    setLoading(false);
  }, [agentId, name, requestedAgent, venue]);
  useEffect(() => {
    setLoading(true);
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!selectedAgent || venue !== "hyperliquid_testnet") return;
    const setup = getAgentHyperliquidSetupSettings(name);
    return startAgentVenueReadinessPolling({
      venue: "hyperliquid_testnet",
      options: {
        walletName: name,
        agentId: selectedAgent.id,
        accountAddress: setup.accountAddress,
      },
      onUpdate: setOutside,
      onError: () => setOutside(null),
    });
  }, [name, selectedAgent, venue]);
  const policy = decryptedPolicy ?? getAgentVaultPolicy(name);
  const setupSettings = getAgentHyperliquidSetupSettings(name);
  const sessions = mergeById<AgentSessionGrant>(
    listAgentSessions(name),
    savedState?.sessions ?? [],
  );
  const proposals = mergeById<AgentTradeProposal>(
    listAgentProposals(name),
    savedState?.proposals ?? [],
  ).filter(
    (proposal) => proposal.agentId === selectedAgent?.id,
  );
  const executions = mergeById<AgentExecutionRecord>(
    listAgentExecutions(name),
    savedState?.executions ?? [],
  ).filter(
    (execution) => execution.agentId === selectedAgent?.id,
  );
  const events = mergeById<AgentAuditEvent>(
    listAgentEvents(name),
    savedState?.events ?? [],
  ).filter((event) => event.agentId === selectedAgent?.id);
  const openExecutions = executions.filter((execution) => execution.status === "open");
  const closedExecutions = executions.filter((execution) => execution.status === "closed");
  const venueRequests =
    outside?.requests?.filter(
      (request) => request.request.agentId === selectedAgent?.id,
    ) ?? [];
  const submittedVenueRequests =
    venueRequests.filter((request) => request.status === "submitted");
  const tradeLifecycles = proposals.map((proposal) =>
    buildAgentTradeLifecycle({
      proposal,
      execution:
        executions.find((execution) => execution.proposalId === proposal.id) ?? null,
      venueRequest:
        venueRequests.find((request) => request.request.proposalId === proposal.id) ?? null,
      accountSnapshot: outside?.accountSnapshot ?? null,
    }),
  );
  const tradeLifecycleSummary = summarizeAgentTradeLifecycles(tradeLifecycles);
  const activeAllowance = selectedAgent
    ? sessions.find(
      (session) =>
        session.agentId === selectedAgent.id &&
        isAgentSessionCurrent(session, policy),
    )
    : undefined;
  const readinessPassed = (id: string) =>
    readiness?.items.find((item) => item.id === id)?.status === "pass";
  const hasTraderIdea =
    (inbox?.count ?? 0) > 0 ||
    proposals.some((proposal) => Boolean(proposal.clientSignalId));
  const firstTradePlaced =
    venue === "mock_perps"
      ? executions.some((execution) => execution.venue === venue)
      : Boolean(
        outside?.requests?.some(
          (request) =>
            request.status === "submitted" &&
            request.request.agentId === selectedAgent?.id,
        ),
      );
  const automaticTradingOn = selectedAgent
    ? connectionKit?.agentId === selectedAgent.id
      ? connectionKit.autoImportSessionSignals
      : getAgentConnectionKit(name, selectedAgent.id).autoImportSessionSignals
    : false;
  const complianceReadiness = useMemo(() => {
    void disclosureRefresh;
    return buildAgentComplianceReadiness(name, venue);
  }, [disclosureRefresh, name, venue]);
  const launchState = buildTradingLaunchState(venue, {
    hasTrader: Boolean(selectedAgent),
    traderActive: selectedAgent?.status === "active",
    planReady: readinessPassed("strategy"),
    safetyReady:
      Boolean(policy.enabled) &&
      !policy.emergencyPaused &&
      policy.allowedVenues.includes(venue) &&
      readinessPassed("risk-limits"),
    allowanceReady:
      Boolean(activeAllowance) &&
      Boolean(activeAllowance && sessionAllowsVenue(activeAllowance, venue, policy)),
    disclosuresAccepted: complianceReadiness.accepted,
    automaticTradingOn,
    accountReady:
      venue === "mock_perps" ||
      Boolean(outside?.accountProbe?.accountAddress),
    accountFunded:
      venue === "mock_perps" ||
      outside?.accountProbe?.state === "funded",
    protectedConnectionReady:
      venue === "mock_perps" ||
      outside?.executorProbe?.state === "ready",
    hasTraderIdea,
    firstTradePlaced,
  });
  const steps = launchState.steps;
  const currentStep = launchState.currentStep;
  const approvedOutsideIdea = proposals.find(
    (proposal) =>
      proposal.venue === "hyperliquid_testnet" && proposal.status === "approved",
  );
  const complete = launchState.complete;
  const openMarketKey = openExecutions
    .map((execution) => execution.market.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join("|");
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
  const requestOwnerApproval = useCallback(
    (
      input: AgentOwnerApprovalInput,
      approveLabel = "Approve",
      mode?: "wallet" | "browser",
    ) =>
      new Promise<AgentOwnerApproval | null>((resolve) => {
        approvalResolver.current?.(null);
        approvalResolver.current = resolve;
        setApprovalApproveLabel(approveLabel);
        setApprovalMode(mode ?? null);
        setApprovalRequest(input);
      }),
    [],
  );
  const cancelOwnerApproval = useCallback(() => {
    approvalResolver.current?.(null);
    approvalResolver.current = null;
    setApprovalRequest(null);
    setApprovalApproveLabel("Approve");
    setApprovalMode(null);
  }, []);
  const approveOwnerRequest = useCallback(async () => {
    if (!approvalRequest) return;
    setApprovalBusy(true);
    try {
      const createdAt = Date.now();
      const signed =
        (approvalMode ?? (canSign ? "wallet" : "browser")) === "wallet"
          ? await signLocalClearText(
              ownerApprovalSignableText(approvalRequest, createdAt),
            )
          : null;
      const approval = await createBrowserOwnerApproval({
        ...approvalRequest,
        now: createdAt,
        approvedBy: signed?.signer_pubkey ?? null,
        signature: signed?.signature ?? null,
      });
      saveAgentOwnerApproval(approval);
      const synced = await syncAgentOwnerApproval(approval);
      if (!synced.ok) {
        toast.info("Approval saved on this device for now", {
          details: synced.message,
        });
      }
      approvalResolver.current?.(approval);
      approvalResolver.current = null;
      setApprovalRequest(null);
      setApprovalApproveLabel("Approve");
      setApprovalMode(null);
    } catch (error) {
      toast.error("Could not approve action", {
        details: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setApprovalBusy(false);
    }
  }, [approvalMode, approvalRequest, canSign, signLocalClearText, toast]);
  const acceptDisclosures = () => {
    acknowledgeAgentComplianceDisclosures({
      walletName: name,
      venue,
    });
    setDisclosureRefresh((value) => value + 1);
    toast.success("Trading disclosures accepted");
  };
  const placeFirstOutsideTrade = (proposal: AgentTradeProposal) => {
    startTransition(async () => {
      const approval = await requestOwnerApproval({
        walletName: name,
        agentId: proposal.agentId,
        action: "submit_venue_trade",
        summary: "Place connected practice trade",
        targetType: "proposal",
        targetId: proposal.id,
        details: [
          { label: "Trader", value: selectedAgent?.name ?? "Selected trader" },
          { label: "Market", value: proposal.market },
          { label: "Size", value: formatUsd(proposal.notionalUsd) },
          { label: "Leverage", value: `${proposal.leverage}x` },
        ],
      });
      if (!approval) return;
      const result = await submitAgentVenueExecution(proposal);
      if (!result.ok) {
        toast.error(result.message);
        await refresh();
        return;
      }
      toast.success("The first connected practice trade was placed");
      await refresh();
    });
  };
  const enableAutomaticTrading = () => {
    if (!selectedAgent) return;
    if (!complianceReadiness.accepted) {
      toast.error("Review the trading disclosures first");
      return;
    }
    if (!canSign) {
      toast.error("Automatic trading needs wallet signing", {
        details: "Connect a wallet that can sign the ClearSig approval.",
      });
      return;
    }
    void (async () => {
      setAutomaticTradingBusy(true);
      try {
        const input: AgentOwnerApprovalInput = {
          walletName: name,
          agentId: selectedAgent.id,
          action: "start_automatic_trading",
          summary: "Turn on automatic trading",
          targetType: "agent",
          targetId: selectedAgent.id,
          details: [
            { label: "Trader", value: selectedAgent.name },
            { label: "Practice account", value: venueLabel(venue) },
          ],
        };
        let approval: AgentOwnerApproval | null;
        toast.info("Approve automatic trading in your wallet");
        const createdAt = Date.now();
        const signed = await signLocalClearText(
          ownerApprovalSignableText(input, createdAt),
        );
        approval = await createBrowserOwnerApproval({
          ...input,
          now: createdAt,
          approvedBy: signed.signer_pubkey,
          signature: signed.signature,
        });
        saveAgentOwnerApproval(approval);
        const synced = await syncAgentOwnerApproval(approval);
        if (!synced.ok) {
          toast.error("Automatic trading approval did not sync", {
            details: synced.message,
          });
          return;
        }
        if (!approval) return;
        const updated = await setAgentAutomaticTrading(name, selectedAgent.id, true);
        setConnectionKit(updated);
        toast.success("Automatic trading is on");
        await refresh();
      } catch (error) {
        toast.error("Could not turn on automatic trading", {
          details: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setAutomaticTradingBusy(false);
      }
    })();
  };
  const askBuiltInTraderForIdea = () => {
    if (!selectedAgent) return;
    startTransition(async () => {
      const draft = createClearSigLibraryPracticeIdea({
        agent: selectedAgent,
        venue,
        maxNotionalUsd: activeAllowance?.maxNotionalUsd,
        maxLeverage: activeAllowance?.maxLeverage ?? policy.maxLeverage,
        marketData: marketSnapshot,
        id: newAgentProposalId(),
      });
      if (!draft) {
        toast.error("This trader does not have a prepared practice idea");
        return;
      }
      const evaluation = evaluateAgentTradeProposal({
        agent: selectedAgent,
        proposal: draft,
        policy,
        session: activeAllowance,
        risk: agentRiskSnapshot(name, selectedAgent.id),
      });
      const checked: AgentTradeProposal = {
        ...draft,
        status:
          evaluation.decision === "allowed"
            ? "approved"
            : evaluation.decision === "requires_human_approval"
              ? "needs_approval"
              : "blocked",
        evaluationDecision: evaluation.decision,
        policyViolations: evaluation.violations,
        decisionJournal: buildAgentTradeDecisionJournal({
          agent: selectedAgent,
          proposal: draft,
          evaluation,
          marketData: marketSnapshot,
        }),
        updatedAt: Date.now(),
      };
      const result =
        evaluation.decision === "allowed" && venue === "mock_perps"
          ? saveAgentProposalAndExecuteIfAllowed(checked)
          : { proposal: saveAgentProposal(checked), execution: null };
      await syncAgentProposal(result.proposal);
      if (result.execution) {
        await syncAgentExecution(result.execution);
        toast.success("The trader's first practice trade is open");
      } else if (
        evaluation.decision === "allowed" &&
        venue === "hyperliquid_testnet"
      ) {
        toast.success("The trader's first practice idea is ready");
      } else if (evaluation.decision === "requires_human_approval") {
        toast.info("The trader prepared an idea for your approval");
      } else {
        toast.info("Your safety rules stopped the trader's idea");
      }
      await refresh();
    });
  };
  const pauseThisTrader = () => {
    if (!selectedAgent) return;
    startTransition(async () => {
      const approval = await requestOwnerApproval({
        walletName: name,
        agentId: selectedAgent.id,
        action: "pause_agent",
        summary: "Pause this trader",
        targetType: "agent",
        targetId: selectedAgent.id,
        details: [
          { label: "Trader", value: selectedAgent.name },
          { label: "Result", value: "It cannot open new trades" },
        ],
      });
      if (!approval) return;
      const updated = updateAgentStatus(name, selectedAgent.id, "paused");
      if (!updated) {
        toast.error("Trader not found");
        return;
      }
      await syncAgentProfile(updated);
      toast.success("Trader paused");
      await refresh();
    });
  };
  const pauseAllTrading = () => {
    startTransition(async () => {
      const approval = await requestOwnerApproval({
        walletName: name,
        action: "pause_all_trading",
        summary: "Pause all agent trading",
        targetType: "policy",
        targetId: "emergency_pause",
        details: [
          { label: "Wallet", value: display },
          { label: "Result", value: "No trader can open new trades" },
        ],
      });
      if (!approval) return;
      setAgentVaultEmergencyPause(name, true);
      const synced = await syncAgentEmergencyPause(name, true);
      setKillSwitchHandoff(synced.killSwitch ?? null);
      toast.success("All agent trading paused", synced.killSwitch
        ? { details: synced.killSwitch.message }
        : undefined);
      await refresh();
    });
  };
  const closeOnePracticeTrade = (id: string, pnlUsd: string) => {
    startTransition(async () => {
      const trade = openExecutions.find((execution) => execution.id === id);
      const approval = await requestOwnerApproval({
        walletName: name,
        agentId: trade?.agentId ?? selectedAgent?.id,
        action: "close_practice_trade",
        summary: "Close practice trade",
        targetType: "execution",
        targetId: id,
        details: [
          { label: "Trade", value: trade ? `${trade.market} ${trade.side}` : "Selected trade" },
          { label: "Recorded P/L", value: formatSignedUsd(pnlUsd || "0") },
        ],
      });
      if (!approval) return;
      const local = closeMockAgentExecution(name, id, pnlUsd);
      const proposal = proposals.find((item) => item.id === trade?.proposalId);
      const updated = local ?? (trade
        ? closeAgentExecutionRecord({ execution: trade, proposal, realizedPnlUsd: pnlUsd })
        : null);
      if (!updated) {
        toast.error("Practice trade not found");
        return;
      }
      await syncAgentExecution(updated);
      toast.success("Practice trade closed");
      await refresh();
    });
  };
  const closeAllPracticeTrades = () => {
    if (!selectedAgent) return;
    startTransition(async () => {
      const approval = await requestOwnerApproval({
        walletName: name,
        agentId: selectedAgent.id,
        action: "close_all_practice_trades",
        summary: "Close all open trades",
        targetType: "agent",
        targetId: selectedAgent.id,
        details: [
          { label: "Trader", value: selectedAgent.name },
          { label: "Open trades", value: String(openExecutions.length) },
        ],
      });
      if (!approval) return;
      const localClosed = closeOpenMockAgentExecutions({
        walletName: name,
        agentId: selectedAgent.id,
      });
      const localClosedIds = new Set(localClosed.map((execution) => execution.id));
      const fallbackClosed = openExecutions
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
        toast.info("No open trades to close");
        return;
      }
      await Promise.all(closed.map((execution) => syncAgentExecution(execution)));
      toast.success(`${closed.length} practice trade${closed.length === 1 ? "" : "s"} closed`);
      await refresh();
    });
  };
  return {
    acceptDisclosures,
    activeAllowance,
    agentId,
    agents,
    approvalApproveLabel,
    approvalBusy,
    approvalMode,
    approvalRequest,
    approvedOutsideIdea,
    approveOwnerRequest,
    askBuiltInTraderForIdea,
    automaticTradingBusy,
    automaticTradingOn,
    cancelOwnerApproval,
    canSign,
    closeAllPracticeTrades,
    closedExecutions,
    closeOnePracticeTrade,
    complete,
    complianceReadiness,
    currentStep,
    display,
    enableAutomaticTrading,
    encoded,
    events,
    killSwitchHandoff,
    launchState,
    loading,
    marketByMarket,
    marketSnapshot,
    marketStatus,
    name,
    openExecutions,
    outside,
    pauseAllTrading,
    pauseThisTrader,
    pending,
    placeFirstOutsideTrade,
    policy,
    readiness,
    refresh,
    selectedAgent,
    setupSettings,
    setAgentId,
    setVenue,
    steps,
    submittedVenueRequests,
    tradeLifecycles,
    tradeLifecycleSummary,
    venue,
    venueRequests,
  };
}
