"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  AlertTriangle,
  Check,
  Clock,
  Circle,
  ExternalLink,
  FileCheck2,
  Info,
  Lightbulb,
  Pause,
  Play,
  PlugZap,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp,
  UserRound,
  WalletCards,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { OwnerApprovalDialog } from "@/components/agents/OwnerApprovalDialog";
import { useToast } from "@/components/ui/Toast";
import {
  agentRiskSnapshot,
  acknowledgeAgentComplianceDisclosures,
  buildAgentTradingReadiness,
  buildAgentComplianceReadiness,
  buildTradingLaunchState,
  closeAgentExecutionRecord,
  closeMockAgentExecution,
  closeOpenMockAgentExecutions,
  createClearSigLibraryPracticeIdea,
  createBrowserOwnerApproval,
  buildAgentTradeDecisionJournal,
  buildAgentTradeLifecycle,
  decryptAgentVaultPolicy,
  estimateAgentOpenTradePerformance,
  evaluateAgentTradeProposal,
  getAgentHyperliquidSetupSettings,
  getAgentConnectionKit,
  getAgentVaultPolicy,
  isAgentSessionCurrent,
  loadAgentBackendState,
  listAgentExecutions,
  listAgentEvents,
  listAgentProposals,
  listAgentSessions,
  listAgents,
  newAgentProposalId,
  ownerApprovalSignableText,
  saveAgentProposal,
  saveAgentProposalAndExecuteIfAllowed,
  saveAgentOwnerApproval,
  syncAgentEmergencyPause,
  syncAgentExecution,
  syncAgentOwnerApproval,
  syncAgentProfile,
  syncAgentProposal,
  setAgentVaultEmergencyPause,
  summarizeAgentTradeLifecycles,
  updateAgentStatus,
  type AgentAuditEvent,
  type AgentComplianceReadiness,
  type AgentConnectionKit,
  type AgentExecutionRecord,
  type AgentKillSwitchHandoff,
  type AgentMarketDataSnapshot,
  type AgentOwnerApproval,
  type AgentOwnerApprovalInput,
  type AgentProfile,
  type AgentSessionGrant,
  type AgentTradeProposal,
  type AgentTradeLifecycle,
  type AgentTradeLifecycleSummary,
  type AgentTradingReadiness,
  type AgentVaultPolicy,
  type TradingLaunchStep,
  type TradingLaunchState,
  type TradingLaunchVenue,
} from "@/lib/agents";
import {
  loadAgentVenueReadiness,
  reconcileAgentVenueRequest,
  startAgentVenueReadinessPolling,
  submitAgentVenueExecution,
  type AgentVenueReadiness,
} from "@/lib/agents/clientExecution";
import {
  loadAgentConnectionKit,
  loadAgentInboxSummary,
  setAgentAutomaticTrading,
  type AgentInboxSummary,
} from "@/lib/agents/clientInbox";
import { loadAgentMarketDataSnapshots } from "@/lib/agents/clientMarketData";
import { useSignWithWallet } from "@/lib/hooks/useSignWithWallet";
import type { AgentServerWalletState } from "@/lib/agents/serverState";
import { toDisplayName } from "@/lib/retail/walletNames";

const PRACTICE_CHOICES: Array<{
  id: TradingLaunchVenue;
  label: string;
  description: string;
}> = [
  {
    id: "mock_perps",
    label: "Built-in practice",
    description: "No funds needed.",
  },
  {
    id: "hyperliquid_testnet",
    label: "Connected practice",
    description: "Use a separate practice account.",
  },
];

export default function StartTradingPage() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();
  const toast = useToast();
  const { canSign, signBytes } = useSignWithWallet();
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
          ? await signBytes(
              new TextEncoder().encode(
                ownerApprovalSignableText(approvalRequest, createdAt),
              ),
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
  }, [approvalMode, approvalRequest, canSign, signBytes, toast]);

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
        const signed = await signBytes(
          new TextEncoder().encode(ownerApprovalSignableText(input, createdAt)),
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

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Trading Desk · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Start practice
            </h1>
          </div>
          <button
            type="button"
            disabled={loading || pending}
            onClick={() => void refresh()}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:opacity-60"
          >
            <RefreshCw className={clsx("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" />
            Check again
          </button>
        </div>
      </header>

      <section className="border-y border-border-soft py-4">
        <p className="text-xs font-semibold text-text-strong">Choose practice mode</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {PRACTICE_CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              onClick={() => setVenue(choice.id)}
              className={clsx(
                "min-h-[4.75rem] rounded-soft border p-3 text-left transition-colors",
                venue === choice.id
                  ? "border-accent/60 bg-accent/[0.06]"
                  : "border-border-soft bg-surface-raised hover:border-accent/40",
              )}
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-text-strong">
                {choice.id === "mock_perps" ? (
                  <Play className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                ) : (
                  <WalletCards className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
                )}
                {choice.label}
              </span>
              <span className="mt-1.5 block text-xs leading-relaxed text-text-soft">
                {choice.description}
              </span>
            </button>
          ))}
        </div>
        {agents.length > 1 ? (
          <label className="mt-4 flex max-w-sm flex-col gap-1.5">
            <span className="text-xs font-medium text-text-soft">Trader</span>
            <select
              value={agentId}
              onChange={(event) => setAgentId(event.target.value)}
              className="w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </section>

      <PrimaryLaunchActionPanel
        state={launchState}
        action={
          currentStep
            ? actionForStep({
                step: currentStep,
                walletEncoded: encoded,
                agent: selectedAgent,
                venue,
                approvedOutsideIdea,
                placeFirstOutsideTrade,
                acceptDisclosures,
                enableAutomaticTrading,
                askBuiltInTraderForIdea,
                pending,
                automaticTradingBusy,
              })
            : (
              <Link href={`/app/wallet/${encoded}/agents`} className={STEP_BUTTON_CLASS}>
                Watch trades
                <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )
        }
      />

      <BetaJourneyPanel
        venue={venue}
        agent={selectedAgent}
        steps={steps}
        complete={complete}
      />

      <ComplianceDisclosurePanel
        readiness={complianceReadiness}
        pending={pending}
        onAccept={acceptDisclosures}
      />

      <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-strong">
              {complete ? "Practice is running" : currentStep?.label ?? "Next step"}
            </h2>
          </div>
          <span
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              complete
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : "border-warning/30 bg-warning/[0.08] text-warning",
            )}
          >
            {steps.filter((step) => step.status === "done").length} of {steps.length} done
          </span>
        </div>

        <ol className="mt-4 grid gap-2">
          <AutomaticTradingStatus
            agent={selectedAgent}
            enabled={automaticTradingOn}
            busy={automaticTradingBusy}
            approvalOpen={
              approvalRequest?.action === "start_automatic_trading" &&
              approvalRequest.agentId === selectedAgent?.id
            }
          />
          {steps.map((step) => (
            <LaunchStepRow
              key={step.id}
              step={step}
              action={actionForStep({
                step,
                walletEncoded: encoded,
                agent: selectedAgent,
                venue,
                approvedOutsideIdea,
                placeFirstOutsideTrade,
                acceptDisclosures,
                enableAutomaticTrading,
                askBuiltInTraderForIdea,
                pending,
                automaticTradingBusy,
              })}
            />
          ))}
        </ol>
      </section>

      <LaunchRiskPanel
        venue={venue}
        agent={selectedAgent}
        policyPaused={policy.emergencyPaused}
        marketSnapshot={marketSnapshot}
        marketStatus={marketStatus}
        readiness={outside}
        venueRequests={venueRequests}
      />

      <TradingControlRoom
        agent={selectedAgent}
        venue={venue}
        allowance={activeAllowance}
        policyPaused={policy.emergencyPaused}
        openExecutions={openExecutions}
        closedExecutions={closedExecutions}
        events={events}
        marketSnapshot={marketSnapshot}
        marketByMarket={marketByMarket}
        marketStatus={marketStatus}
        accountSnapshot={outside?.accountSnapshot ?? null}
        reconciliation={outside?.reconciliation ?? null}
        venueRequests={venueRequests}
        tradeLifecycles={tradeLifecycles}
        tradeLifecycleSummary={tradeLifecycleSummary}
        killSwitchHandoff={killSwitchHandoff}
        submittedVenueRequests={submittedVenueRequests.length}
        pending={pending}
        onPauseAgent={pauseThisTrader}
        onPauseAll={pauseAllTrading}
        onCloseOne={closeOnePracticeTrade}
        onCloseAll={closeAllPracticeTrades}
      />

      {venue === "hyperliquid_testnet" ? (
        <HyperliquidHelp
          readiness={outside}
          walletEncoded={encoded}
          setupSettings={getAgentHyperliquidSetupSettings(name)}
        />
      ) : (
        <section className="rounded-card border border-accent/25 bg-accent/[0.05] p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-text-strong">No outside account needed</p>
            </div>
          </div>
        </section>
      )}

      <OwnerApprovalDialog
        request={approvalRequest}
        approvalMode={approvalMode ?? (canSign ? "wallet" : "browser")}
        approveLabel={approvalApproveLabel}
        busy={approvalBusy}
        onCancel={cancelOwnerApproval}
        onApprove={() => void approveOwnerRequest()}
      />
    </div>
  );
}

function BetaJourneyPanel({
  venue,
  agent,
  steps,
  complete,
}: {
  venue: TradingLaunchVenue;
  agent: AgentProfile | null;
  steps: TradingLaunchStep[];
  complete: boolean;
}) {
  const done = (ids: TradingLaunchStep["id"][]) =>
    ids.every((id) => steps.find((step) => step.id === id)?.status === "done");
  const journey = [
    {
      label: "Choose trader",
      detail: agent?.name ?? "No trader selected",
      done: done(["trader", "plan"]),
      Icon: UserRound,
    },
    {
      label: "Set budget",
      detail: venueLabel(venue),
      done: done(["safety", "allowance"]),
      Icon: SlidersHorizontal,
    },
    {
      label: "Accept disclosures",
      detail: "Automation terms",
      done: done(["disclosures"]),
      Icon: Info,
    },
    {
      label: "Turn on automation",
      detail: "Inside budget only",
      done: done(["automatic"]),
      Icon: Zap,
    },
    {
      label: "Watch trades",
      detail: complete ? "First trade placed" : "Waiting for first trade",
      done: done(["first_trade"]),
      Icon: Play,
    },
  ];
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-strong">
            Launch checklist
          </p>
        </div>
        <span className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-1 text-[11px] font-medium text-accent">
          {venue === "hyperliquid_testnet" ? "Connected practice" : "Built-in practice"}
        </span>
      </div>
      <div className="mt-3 grid gap-2 md:grid-cols-5">
        {journey.map((item) => {
          const Icon = item.Icon;
          return (
          <div
            key={item.label}
            className={clsx(
              "min-w-0 rounded-soft border px-3 py-2",
              item.done
                ? "border-accent/25 bg-accent/[0.06]"
                : "border-border-soft bg-canvas",
            )}
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                  item.done
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-border-soft text-text-muted",
                )}
              >
                {item.done ? (
                  <Check className="h-3 w-3" aria-hidden="true" />
                ) : (
                  <Icon className="h-3 w-3" aria-hidden="true" />
                )}
              </span>
              <p className="truncate text-xs font-semibold text-text-strong">
                {item.label}
              </p>
            </div>
            <p className="mt-1 break-words text-[11px] leading-relaxed text-text-soft">
              {item.detail}
            </p>
          </div>
          );
        })}
      </div>
    </section>
  );
}

function PrimaryLaunchActionPanel({
  state,
  action,
}: {
  state: TradingLaunchState;
  action: React.ReactNode;
}) {
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest sm:p-5",
        state.statusTone === "ready"
          ? "border-accent/30 bg-accent/[0.06]"
          : state.statusTone === "blocked"
            ? "border-warning/30 bg-warning/[0.08]"
            : "border-border-soft bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-text-soft">
            {state.modeLabel}
          </p>
          <h2 className="mt-1 text-sm font-semibold text-text-strong">
            {state.complete ? "Practice is ready" : "Next action"}
          </h2>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            state.statusTone === "ready"
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : state.statusTone === "blocked"
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-border-soft bg-canvas text-text-soft",
          )}
        >
          {state.completedSteps} of {state.totalSteps}
        </span>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-soft border border-border-soft bg-canvas p-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-strong">
            {state.statusLabel}
          </p>
          {state.currentStep ? (
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-text-soft">
              {state.currentStep.description}
            </p>
          ) : null}
        </div>
        <div className="w-full shrink-0 sm:w-auto">{action}</div>
      </div>
    </section>
  );
}

function LaunchRiskPanel({
  venue,
  agent,
  policyPaused,
  marketSnapshot,
  marketStatus,
  readiness,
  venueRequests,
}: {
  venue: TradingLaunchVenue;
  agent: AgentProfile | null;
  policyPaused: boolean;
  marketSnapshot: AgentMarketDataSnapshot | null;
  marketStatus: string;
  readiness: AgentVenueReadiness | null;
  venueRequests: NonNullable<AgentVenueReadiness["requests"]>;
}) {
  const notices: Array<{
    id: string;
    tone: "warning" | "danger" | "default";
    title: string;
    detail: string;
  }> = [];
  if (policyPaused) {
    notices.push({
      id: "policy_paused",
      tone: "danger",
      title: "All agent trading is paused",
      detail: "ClearSig will not open new trades until the vault pause is lifted.",
    });
  }
  if (agent?.status === "paused") {
    notices.push({
      id: "agent_paused",
      tone: "warning",
      title: "Selected trader is paused",
      detail: "This trader cannot open new trades until it is reactivated.",
    });
  }
  if (!marketSnapshot) {
    notices.push({
      id: "market_data",
      tone: "warning",
      title: "Market data not confirmed",
      detail: marketStatus,
    });
  }
  const reconciliation = readiness?.reconciliation;
  if (venue === "hyperliquid_testnet" && reconciliation) {
    if (reconciliation.adapterErrors > 0) {
      notices.push({
        id: "adapter_errors",
        tone: "danger",
        title: "Trading connection needs attention",
        detail: reconciliation.message,
      });
    } else if (reconciliation.status !== "healthy") {
      notices.push({
        id: "reconciliation",
        tone: "warning",
        title: "Practice account needs review",
        detail: reconciliation.message,
      });
    }
    if (reconciliation.pendingRequests > 0) {
      notices.push({
        id: "pending_requests",
        tone: "warning",
        title: "Practice requests are waiting",
        detail: `${reconciliation.pendingRequests} request${reconciliation.pendingRequests === 1 ? "" : "s"} need attention before trading continues.`,
      });
    }
  } else if (
    venue === "hyperliquid_testnet" &&
    venueRequests.some((request) => request.status === "adapter_error")
  ) {
    notices.push({
      id: "adapter_errors_fallback",
      tone: "danger",
      title: "Trading connection needs attention",
      detail: "At least one practice request could not be completed.",
    });
  }

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-strong">
            Safety checks
          </h2>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium",
            notices.some((notice) => notice.tone === "danger")
              ? "border-danger/30 bg-danger/[0.06] text-danger"
              : notices.length > 0
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-accent/30 bg-accent/[0.08] text-accent",
          )}
        >
          {notices.length === 0 ? "Clear" : `${notices.length} notice${notices.length === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="mt-3 grid gap-2">
        {notices.length > 0 ? (
          notices.map((notice) => (
            <div
              key={notice.id}
              className={clsx(
                "rounded-soft border px-3 py-2",
                notice.tone === "danger"
                  ? "border-danger/30 bg-danger/[0.06]"
                  : notice.tone === "warning"
                    ? "border-warning/30 bg-warning/[0.08]"
                    : "border-border-soft bg-canvas",
              )}
            >
              <p
                className={clsx(
                  "text-xs font-semibold",
                  notice.tone === "danger"
                    ? "text-danger"
                    : notice.tone === "warning"
                      ? "text-warning"
                      : "text-text-strong",
                )}
              >
                {notice.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-text-soft">
                {notice.detail}
              </p>
            </div>
          ))
        ) : (
          <div className="rounded-soft border border-accent/25 bg-accent/[0.05] px-3 py-2 text-xs leading-relaxed text-text-soft">
            No blocker is visible right now.
          </div>
        )}
      </div>
    </section>
  );
}

function LaunchStepRow({
  step,
  action,
}: {
  step: TradingLaunchStep;
  action: React.ReactNode;
}) {
  const StepIcon = launchStepIcon(step.id);
  return (
    <li
      className={clsx(
        "flex flex-wrap items-center gap-3 rounded-soft border px-3 py-3",
        step.status === "current"
          ? "border-accent/40 bg-accent/[0.06]"
          : "border-border-soft bg-canvas",
      )}
    >
      <span
        className={clsx(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
          step.status === "done"
            ? "border-accent/30 bg-accent/10 text-accent"
            : step.status === "current"
              ? "border-accent bg-accent text-text-on-accent"
              : "border-border-soft text-text-muted",
        )}
      >
        {step.status === "done" ? (
          <Check className="h-4 w-4" aria-hidden="true" />
        ) : (
          <StepIcon className="h-4 w-4" aria-hidden="true" strokeWidth={1.9} />
        )}
      </span>
      <div className="min-w-0 flex-1 basis-48">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-text-strong">{step.label}</p>
          <span className="rounded-full border border-border-soft px-1.5 py-0.5 text-[10px] font-medium text-text-soft">
            {ownerLabel(step.owner)}
          </span>
          <details className="group relative">
            <summary
              className="inline-flex h-6 w-6 cursor-pointer list-none items-center justify-center rounded-full border border-border-soft text-text-soft transition-colors hover:border-accent/40 hover:text-accent"
              aria-label={`Show details for ${step.label}`}
            >
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
            </summary>
            <p className="absolute left-0 z-20 mt-2 w-[min(18rem,70vw)] rounded-soft border border-border-soft bg-surface-raised p-3 text-xs leading-relaxed text-text-soft shadow-card-rest">
              {step.description}
            </p>
          </details>
        </div>
      </div>
      {step.status === "current" ? <div className="w-full sm:w-auto">{action}</div> : null}
      {step.status === "waiting" ? <Circle className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" /> : null}
    </li>
  );
}

function launchStepIcon(id: TradingLaunchStep["id"]): LucideIcon {
  switch (id) {
    case "trader":
      return UserRound;
    case "plan":
      return FileCheck2;
    case "safety":
      return ShieldCheck;
    case "allowance":
      return SlidersHorizontal;
    case "disclosures":
      return Info;
    case "account":
      return WalletCards;
    case "funding":
      return TrendingUp;
    case "protected_connection":
      return PlugZap;
    case "automatic":
      return Zap;
    case "first_idea":
      return Lightbulb;
    case "first_trade":
      return Play;
  }
}

function ComplianceDisclosurePanel({
  readiness,
  pending,
  onAccept,
}: {
  readiness: AgentComplianceReadiness;
  pending: boolean;
  onAccept: () => void;
}) {
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest sm:p-5",
        readiness.accepted
          ? "border-accent/25 bg-accent/[0.05]"
          : "border-warning/30 bg-warning/[0.07]",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              readiness.accepted
                ? "bg-accent/10 text-accent"
                : "bg-warning/[0.12] text-warning",
            )}
          >
            {readiness.accepted ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Trading disclosures
            </h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-text-soft">
              {readiness.accepted
                ? "Accepted for this wallet and venue."
                : "Required before automation."}
            </p>
          </div>
        </div>
        {readiness.accepted ? (
          <span className="rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-1 text-[11px] font-medium text-accent">
            Accepted
          </span>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={onAccept}
            className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            Accept disclosures
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {readiness.accepted ? (
        <details className="group mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-2">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-text-strong">
            <span className="inline-flex items-center gap-2">
              <Info className="h-3.5 w-3.5 text-accent" aria-hidden="true" />
              Review disclosure details
            </span>
            <ArrowRight
              className="h-3.5 w-3.5 text-text-soft transition-transform group-open:rotate-90"
              aria-hidden="true"
            />
          </summary>
          <DisclosureItems readiness={readiness} />
        </details>
      ) : (
        <DisclosureItems readiness={readiness} className="mt-4" />
      )}
    </section>
  );
}

function DisclosureItems({
  readiness,
  className,
}: {
  readiness: AgentComplianceReadiness;
  className?: string;
}) {
  return (
    <div className={clsx("grid gap-2 md:grid-cols-2", className)}>
      {readiness.required.map((item) => {
        const accepted = !readiness.missing.some((missing) => missing.id === item.id);
        return (
          <div
            key={item.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  accepted ? "bg-accent" : "bg-warning",
                )}
              />
              <p className="text-xs font-semibold text-text-strong">
                {item.label}
              </p>
            </div>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {item.summary}
            </p>
          </div>
        );
      })}
    </div>
  );
}

function AutomaticTradingStatus({
  agent,
  enabled,
  busy,
  approvalOpen,
}: {
  agent: AgentProfile | null;
  enabled: boolean;
  busy: boolean;
  approvalOpen: boolean;
}) {
  const tone = enabled
    ? "border-accent/30 bg-accent/[0.08] text-accent"
    : approvalOpen || busy
      ? "border-warning/30 bg-warning/[0.08] text-warning"
      : "border-border-soft bg-canvas text-text-soft";
  const label = enabled
    ? "Automatic trading is on"
    : approvalOpen
      ? "Approval is open"
      : busy
        ? "Turning on automatic trading"
        : agent
          ? "Automatic trading is off"
          : "Choose a trader first";
  return (
    <li className={clsx("rounded-soft border px-3 py-2.5", tone)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold">{label}</p>
        <span className="rounded-full border border-current/25 px-2 py-0.5 text-[10px] font-medium">
          Automation
        </span>
      </div>
    </li>
  );
}

function HyperliquidHelp({
  readiness,
  walletEncoded,
  setupSettings,
}: {
  readiness: AgentVenueReadiness | null;
  walletEncoded: string;
  setupSettings: ReturnType<typeof getAgentHyperliquidSetupSettings>;
}) {
  const account = readiness?.accountProbe;
  const protectedConnection = readiness?.executorProbe;
  const executorApiWallet = protectedConnection?.agentWalletAddress ?? "";
  const savedApiWallet = setupSettings.agentWalletAddress;
  const apiWalletHealthy =
    protectedConnection?.state === "ready" &&
    setupSettings.delegationStatus === "active" &&
    Boolean(savedApiWallet) &&
    Boolean(executorApiWallet) &&
    savedApiWallet.toLowerCase() === executorApiWallet.toLowerCase();
  const apiWalletMismatch =
    Boolean(savedApiWallet) &&
    Boolean(executorApiWallet) &&
    savedApiWallet.toLowerCase() !== executorApiWallet.toLowerCase();
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <h2 className="text-sm font-semibold text-text-strong">Practice account</h2>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <CheckStat
          label="Account"
          value={account?.accountAddress ? shortAddress(account.accountAddress) : "Not connected"}
          ready={Boolean(account?.accountAddress)}
        />
        <CheckStat
          label="Practice funds"
          value={account?.state === "funded" ? "Confirmed" : account?.state === "empty" ? "Needed" : "Not confirmed"}
          ready={account?.state === "funded"}
        />
        <CheckStat
          label="Trading key"
          value={
            savedApiWallet
              ? apiWalletHealthy
                ? "Active"
                : setupSettings.delegationStatus === "revoked"
                  ? "Revoked"
                  : apiWalletMismatch
                    ? "Mismatch"
                    : "Verify"
              : "Needed"
          }
          ready={apiWalletHealthy}
        />
        <CheckStat
          label="Connection"
          value={protectedConnection?.state === "ready" ? "Ready" : "Pending"}
          ready={protectedConnection?.state === "ready"}
        />
      </div>
      {!apiWalletHealthy && savedApiWallet ? (
        <div className="mt-4 rounded-soft border border-warning/30 bg-warning/[0.08] p-3">
          <p className="text-xs font-semibold text-warning">
            Trading key not ready
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {apiWalletMismatch
              ? "The saved trading key does not match the connected practice account."
              : setupSettings.delegationStatus === "revoked"
              ? "Approve and save a new trading key."
              : setupSettings.rotationReason ??
                "Check the practice connection before trading."}
          </p>
        </div>
      ) : null}
      <details className="group mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-3">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-xs font-semibold text-text-strong">
          <span>Setup steps</span>
          <ArrowRight
            className="h-3.5 w-3.5 text-text-soft transition-transform group-open:rotate-90"
            aria-hidden="true"
          />
        </summary>
        <ol className="mt-3 grid gap-2 border-t border-border-soft pt-3">
          {[
            "Open Hyperliquid practice and sign in with a separate account.",
            "Add practice funds to that account.",
            "Approve a separate trading key for agent practice.",
            "Save the account address and approved trading key in ClearSig.",
            "Check again.",
          ].map((instruction, index) => (
            <li key={instruction} className="flex items-start gap-3 text-xs leading-relaxed text-text-soft">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-soft text-[10px] font-semibold text-text-strong">
                {index + 1}
              </span>
              {instruction}
            </li>
          ))}
        </ol>
      </details>
      {readiness && protectedConnection?.state !== "ready" ? (
        <div className="mt-4 rounded-soft border border-warning/30 bg-warning/[0.08] p-3">
          <p className="text-xs font-semibold text-warning">Protected connection pending</p>
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <a
          href="https://app.hyperliquid-testnet.xyz/"
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          Open practice account
          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
        <Link
          href={`/app/wallet/${walletEncoded}/agents/hyperliquid`}
          className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          Guide
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}

function TradingControlRoom({
  agent,
  venue,
  allowance,
  policyPaused,
  openExecutions,
  closedExecutions,
  events,
  marketSnapshot,
  marketByMarket,
  marketStatus,
  accountSnapshot,
  reconciliation,
  venueRequests,
  tradeLifecycles,
  tradeLifecycleSummary,
  killSwitchHandoff,
  submittedVenueRequests,
  pending,
  onPauseAgent,
  onPauseAll,
  onCloseOne,
  onCloseAll,
}: {
  agent: AgentProfile | null;
  venue: TradingLaunchVenue;
  allowance?: AgentSessionGrant;
  policyPaused: boolean;
  openExecutions: AgentExecutionRecord[];
  closedExecutions: AgentExecutionRecord[];
  events: AgentAuditEvent[];
  marketSnapshot: AgentMarketDataSnapshot | null;
  marketByMarket: Record<string, AgentMarketDataSnapshot>;
  marketStatus: string;
  accountSnapshot: AgentVenueReadiness["accountSnapshot"] | null;
  reconciliation: AgentVenueReadiness["reconciliation"] | null;
  venueRequests: NonNullable<AgentVenueReadiness["requests"]>;
  tradeLifecycles: AgentTradeLifecycle[];
  tradeLifecycleSummary: AgentTradeLifecycleSummary;
  killSwitchHandoff: AgentKillSwitchHandoff | null;
  submittedVenueRequests: number;
  pending: boolean;
  onPauseAgent: () => void;
  onPauseAll: () => void;
  onCloseOne: (id: string, pnlUsd: string) => void;
  onCloseAll: () => void;
}) {
  const agentPaused = agent?.status === "paused";
  const live = Boolean(agent && allowance && !policyPaused && !agentPaused);
  const venuePositions = accountSnapshot?.positions ?? [];
  const reconciliationWarning =
    venue === "hyperliquid_testnet" && reconciliation?.status !== "healthy"
      ? reconciliation?.message
      : venue === "hyperliquid_testnet" &&
          submittedVenueRequests > venuePositions.length
        ? "ClearSig has submitted more practice trades than the account currently shows. Check the practice connection or exchange history."
      : null;
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-text-strong">
              My trades
            </h2>
            <span
              className={clsx(
                "rounded-full border px-2 py-1 text-[10px] font-medium",
                live
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
              )}
            >
              {live ? "Ready to trade" : policyPaused ? "Paused by vault" : agentPaused ? "Trader paused" : "Setup needed"}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={pending || !agent || agentPaused}
            onClick={onPauseAgent}
            className={CONTROL_BUTTON_CLASS}
          >
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
            Pause trader
          </button>
          <button
            type="button"
            disabled={pending || policyPaused}
            onClick={onPauseAll}
            className={DANGER_BUTTON_CLASS}
          >
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Pause all
          </button>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-5">
        <ControlStat
          label="Status"
          value={live ? "Ready" : policyPaused ? "Paused" : agentPaused ? "Trader paused" : "Setup needed"}
          highlight={live}
        />
        <ControlStat
          label="Open trades"
          value={String(openExecutions.length)}
          highlight={openExecutions.length > 0}
        />
        <ControlStat
          label="Budget"
          value={allowance ? formatUsd(allowance.maxNotionalUsd) : "None"}
          highlight={Boolean(allowance)}
        />
        <ControlStat
          label="Pipeline"
          value={tradeLifecycleSummary.label}
          highlight={tradeLifecycleSummary.tone === "success"}
        />
        <ControlStat
          label="Needs action"
          value={String(tradeLifecycleSummary.actionable)}
          highlight={tradeLifecycleSummary.actionable === 0}
        />
      </div>

      <CollapsibleControlPanel
        title="Decision pipeline"
        summary={`${tradeLifecycleSummary.total} decision${tradeLifecycleSummary.total === 1 ? "" : "s"} · ${tradeLifecycleSummary.open} open`}
        defaultOpen={tradeLifecycleSummary.actionable > 0}
      >
        <div className="grid gap-2">
          {tradeLifecycles.length > 0 ? (
            tradeLifecycles.slice(0, 6).map((lifecycle, index) => (
              <TradeLifecycleRow
                key={`${lifecycle.status}:${index}`}
                lifecycle={lifecycle}
              />
            ))
          ) : (
            <EmptyControlLine text="No trade decisions yet." />
          )}
        </div>
      </CollapsibleControlPanel>

      {killSwitchHandoff ? (
        <KillSwitchHandoffCard handoff={killSwitchHandoff} />
      ) : null}

      {venue === "hyperliquid_testnet" ? (
        <CollapsibleControlPanel
          title="Practice account details"
          summary={
            accountSnapshot?.state === "funded"
              ? `${venuePositions.length} open on Hyperliquid`
              : accountSnapshot?.message ?? "Not checked"
          }
          defaultOpen={venuePositions.length > 0 || Boolean(reconciliationWarning)}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-text-strong">
                Practice account
              </p>
            </div>
            <span
              className={clsx(
                "rounded-full border px-2 py-1 text-[10px] font-medium",
                accountSnapshot?.state === "funded"
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
              )}
            >
              {accountSnapshot?.state === "funded"
                ? "Account reachable"
                : accountSnapshot?.message ?? "Account not checked"}
            </span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <ControlStat
              label="Account value"
              value={formatUsd(accountSnapshot?.accountValueUsd)}
              highlight={Number(accountSnapshot?.accountValueUsd ?? 0) > 0}
            />
            <ControlStat
              label="Withdrawable"
              value={formatUsd(accountSnapshot?.withdrawableUsd)}
            />
            <ControlStat
              label="Practice P/L"
              value={formatSignedUsd(accountSnapshot?.unrealizedPnlUsd ?? "0")}
              highlight={Number(accountSnapshot?.unrealizedPnlUsd ?? 0) !== 0}
            />
            <ControlStat
              label="Open positions"
              value={String(venuePositions.length)}
              highlight={venuePositions.length > 0}
            />
          </div>
          {reconciliation ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <ControlStat
                label="Submitted"
                value={String(reconciliation.submittedRequests)}
                highlight={reconciliation.submittedRequests > 0}
              />
              <ControlStat
                label="Pending"
                value={String(reconciliation.pendingRequests)}
                highlight={reconciliation.pendingRequests === 0}
              />
              <ControlStat
                label="Errors"
                value={String(reconciliation.adapterErrors)}
                highlight={reconciliation.adapterErrors === 0}
              />
              <ControlStat
                label="Mismatches"
                value={String(reconciliation.unmatchedPositions + reconciliation.missingOrderIds)}
                highlight={reconciliation.unmatchedPositions + reconciliation.missingOrderIds === 0}
              />
            </div>
          ) : null}
          {reconciliationWarning ? (
            <div className="mt-3 rounded-soft border border-warning/30 bg-warning/[0.08] px-3 py-2 text-xs leading-relaxed text-warning">
              {reconciliationWarning}
            </div>
          ) : null}
          <div className="mt-3 grid gap-2">
            {venuePositions.length > 0 ? (
              venuePositions.map((position) => (
                <VenuePositionRow
                  key={`${position.market}:${position.side}:${position.size}`}
                  position={position}
                />
              ))
            ) : (
              <EmptyControlLine text="No connected practice positions are open right now." />
            )}
          </div>
          <div className="mt-4 border-t border-border-soft pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs font-semibold text-text-strong">Practice activity</p>
              <span className="text-[11px] text-text-soft">
                {venueRequests.length} request{venueRequests.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="grid gap-2">
              {venueRequests.length > 0 ? (
                venueRequests.slice(0, 5).map((request, index) => (
                  <VenueRequestRow
                    key={request.id ?? `${request.request.proposalId}:${index}`}
                    request={request}
                    accountSnapshot={accountSnapshot}
                  />
                ))
              ) : (
                <EmptyControlLine text="No venue trade requests have been sent yet." />
              )}
            </div>
          </div>
        </CollapsibleControlPanel>
      ) : null}

      <CollapsibleControlPanel
        title="Market details"
        summary={marketSnapshot ? `${marketSnapshot.market} ${formatUsd(marketSnapshot.markPriceUsd)}` : marketStatus}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-text-strong">Market used for decisions</p>
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              {marketSnapshot
                ? `${marketSnapshot.market} mark price ${formatUsd(marketSnapshot.markPriceUsd)} from ${marketSnapshot.source === "live" ? "live Hyperliquid public data" : "practice data"}.`
                : marketStatus}
            </p>
          </div>
          {marketSnapshot ? (
            <span className="rounded-full border border-accent/30 bg-accent/[0.08] px-2 py-1 text-[10px] font-medium text-accent">
              {marketSnapshot.source === "live" ? "Real market" : "Practice market"}
            </span>
          ) : null}
        </div>
        {marketSnapshot ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <ControlStat
              label="Funding"
              value={marketSnapshot.fundingRatePct == null ? "Unknown" : `${marketSnapshot.fundingRatePct}%`}
            />
            <ControlStat
              label="Open interest"
              value={marketSnapshot.openInterestUsd == null ? "Unknown" : formatCompactUsd(marketSnapshot.openInterestUsd)}
            />
            <ControlStat
              label="24h volume"
              value={marketSnapshot.volume24hUsd == null ? "Unknown" : formatCompactUsd(marketSnapshot.volume24hUsd)}
            />
          </div>
        ) : null}
      </CollapsibleControlPanel>

      <div className="mt-4 grid gap-3">
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs font-semibold text-text-strong">Open trades</p>
            <button
              type="button"
              disabled={pending || openExecutions.length === 0}
              onClick={onCloseAll}
              className={DANGER_BUTTON_CLASS}
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              Close all open trades
            </button>
          </div>
          <div className="grid gap-2">
            {openExecutions.length > 0 ? (
              openExecutions.map((execution) => (
                <OpenTradeRow
                  key={execution.id}
                  execution={execution}
                  marketSnapshot={marketByMarket[execution.market.trim().toUpperCase()] ?? null}
                  pending={pending}
                  onClose={onCloseOne}
                />
              ))
            ) : (
              <EmptyControlLine text="No open trades right now." />
            )}
          </div>
        </div>

        <CollapsibleControlPanel
          title="Recent actions"
          summary={`${events.length} saved action${events.length === 1 ? "" : "s"} · ${closedExecutions.length} closed trade${closedExecutions.length === 1 ? "" : "s"}`}
        >
          <div className="grid gap-2">
            {events.length > 0 ? (
              events.slice(0, 5).map((event) => (
                <div
                  key={event.id}
                  className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2"
                >
                  <p className="break-words text-xs font-medium text-text-strong">{event.message}</p>
                  <p className="mt-1 text-[11px] text-text-soft">
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                </div>
              ))
            ) : (
              <EmptyControlLine text="No recent actions yet." />
            )}
          </div>
        </CollapsibleControlPanel>
      </div>
    </section>
  );
}

function CollapsibleControlPanel({
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  title: string;
  summary: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="mt-4 rounded-soft border border-border-soft bg-canvas px-3 py-3"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 text-xs font-semibold text-text-strong marker:hidden">
        <span>{title}</span>
        <span className="max-w-full break-words text-right text-[11px] font-medium text-text-soft">
          {summary}
        </span>
      </summary>
      <div className="mt-3 border-t border-border-soft pt-3">
        {children}
      </div>
    </details>
  );
}

function OpenTradeRow({
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
  const performance = estimateAgentOpenTradePerformance(execution, marketSnapshot);
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-text-strong">
            {execution.market} · {execution.side}
          </p>
          <p className="mt-1 break-words text-xs text-text-soft">
            {venueLabel(execution.venue)} · {formatUsd(execution.notionalUsd)} · {execution.leverage}x
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            <ControlStat
              label="Entry"
              value={formatUsd(execution.entryPrice)}
              highlight={Boolean(execution.entryPrice)}
            />
            <ControlStat
              label="Mark"
              value={performance ? formatUsd(performance.markPriceUsd) : "Waiting"}
              highlight={Boolean(performance)}
            />
            <ControlStat
              label="Est. P/L"
              value={performance ? formatSignedUsd(performance.unrealizedPnlUsd) : "Unknown"}
              highlight={Boolean(performance && Number(performance.unrealizedPnlUsd) !== 0)}
            />
          </div>
          <p className="mt-1 break-words text-[11px] text-text-soft">
            Opened {new Date(execution.openedAt).toLocaleString()}
          </p>
        </div>
        <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:w-auto">
          <input
            value={pnlUsd}
            onChange={(event) => setPnlUsd(event.target.value)}
            inputMode="decimal"
            placeholder="P/L"
            className="min-h-9 min-w-0 rounded-soft border border-border-soft bg-surface-raised px-2 py-1 text-xs text-text-strong placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 sm:w-24"
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => onClose(execution.id, pnlUsd || performance?.unrealizedPnlUsd || "0")}
            className={CONTROL_BUTTON_CLASS}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TradeLifecycleRow({ lifecycle }: { lifecycle: AgentTradeLifecycle }) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className={clsx(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
              lifecycleToneClass(lifecycle.tone),
            )}
          >
            {lifecycle.tone === "danger" ? (
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            ) : lifecycle.tone === "warning" ? (
              <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </span>
          <p className="truncate text-xs font-semibold text-text-strong">
            {lifecycle.label}
          </p>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2 py-0.5 text-[10px] font-medium",
            lifecycleToneClass(lifecycle.tone),
          )}
        >
          {lifecycle.steps.filter((step) => step.status === "done").length} of{" "}
          {lifecycle.steps.length}
        </span>
      </div>
      <div className="mt-2 grid gap-1.5 sm:grid-cols-5">
        {lifecycle.steps.map((step) => {
          const Icon = lifecycleStepIcon(step.status);
          return (
            <div
              key={step.id}
              title={step.detail}
              className={clsx(
                "flex min-h-9 min-w-0 items-center gap-1.5 rounded-soft border px-2 py-1",
                lifecycleStepClass(step.status),
              )}
            >
              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-[10px] font-semibold">{step.label}</p>
                <p className="truncate text-[10px] opacity-75">{step.detail}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function KillSwitchHandoffCard({ handoff }: { handoff: AgentKillSwitchHandoff }) {
  return (
    <div
      className={clsx(
        "mt-4 rounded-soft border px-3 py-2",
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

function VenuePositionRow({
  position,
}: {
  position: NonNullable<AgentVenueReadiness["accountSnapshot"]>["positions"][number];
}) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-surface-raised px-3 py-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-text-strong">
            {position.market} · {position.side}
          </p>
          <p className="mt-1 break-words text-xs text-text-soft">
            Size {position.size} · Entry {formatUsd(position.entryPriceUsd)}
          </p>
        </div>
        <div className="min-w-0 text-left sm:text-right">
          <p
            className={clsx(
              "break-words text-xs font-semibold",
              Number(position.unrealizedPnlUsd ?? 0) > 0
                ? "text-accent"
                : Number(position.unrealizedPnlUsd ?? 0) < 0
                  ? "text-rose-300"
                  : "text-text-strong",
            )}
          >
            {formatSignedUsd(position.unrealizedPnlUsd ?? "0")}
          </p>
          <p className="mt-1 break-words text-[11px] text-text-soft">
            Value {formatUsd(position.positionValueUsd)}
          </p>
        </div>
      </div>
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
      return "border-border-soft bg-surface-raised text-text-soft";
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
      return "border-border-soft bg-surface-raised text-text-soft";
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
      return Circle;
  }
}

function VenueRequestRow({
  request,
  accountSnapshot,
}: {
  request: NonNullable<AgentVenueReadiness["requests"]>[number];
  accountSnapshot: AgentVenueReadiness["accountSnapshot"] | null;
}) {
  const submitted = request.status === "submitted";
  const rejected = request.status === "rejected" || request.status === "adapter_error";
  const reconciliation = reconcileAgentVenueRequest(request, accountSnapshot);
  const market = request.request.market ?? "Trade";
  const size = request.request.notionalUsd ? formatUsd(request.request.notionalUsd) : "Size unknown";
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-text-strong">
            {market} {request.request.side ?? ""}
          </p>
          <p className="mt-1 break-words text-[11px] text-text-soft">
            {size}
            {typeof request.request.leverage === "number" ? ` · ${request.request.leverage}x` : ""}
            {request.artifact?.orderId ? ` · Order ${request.artifact.orderId}` : ""}
          </p>
        </div>
        <span
          className={clsx(
            "rounded-full border px-2 py-1 text-[10px] font-medium",
            submitted
              ? "border-accent/30 bg-accent/[0.08] text-accent"
              : rejected
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-border-soft text-text-soft",
          )}
        >
          {venueRequestStatusLabel(request.status)}
        </span>
      </div>
      {submitted ? (
        <div
          className={clsx(
            "mt-2 rounded-soft border px-2 py-1.5 text-xs leading-relaxed",
            reconciliation.state === "open_on_venue"
              ? "border-accent/25 bg-accent/[0.08] text-text-strong"
              : reconciliation.state === "not_found" ||
                  reconciliation.state === "executor_error"
                ? "border-warning/30 bg-warning/[0.08] text-warning"
                : "border-border-soft text-text-soft",
          )}
        >
          <span className="font-semibold">{reconciliation.label}:</span>{" "}
          {reconciliation.message}
        </div>
      ) : null}
      {request.message ? (
        <p className="mt-2 break-words text-xs leading-relaxed text-text-soft">
          {request.message}
        </p>
      ) : null}
      {request.updatedAt ? (
        <p className="mt-1 text-[11px] text-text-muted">
          {new Date(request.updatedAt).toLocaleString()}
        </p>
      ) : null}
    </div>
  );
}

function ControlStat({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className={clsx("mt-1 break-words text-xs font-semibold", highlight ? "text-accent" : "text-text-strong")}>
        {value}
      </p>
    </div>
  );
}

function EmptyControlLine({ text }: { text: string }) {
  return (
    <div className="min-w-0 break-words rounded-soft border border-dashed border-border-soft bg-canvas px-3 py-3 text-xs text-text-soft">
      {text}
    </div>
  );
}

function CheckStat({ label, value, ready }: { label: string; value: string; ready: boolean }) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-[11px] font-medium text-text-soft">{label}</p>
      <p className={clsx("mt-1 break-words text-xs font-semibold", ready ? "text-accent" : "text-warning")}>
        {value}
      </p>
    </div>
  );
}

function actionForStep({
  step,
  walletEncoded,
  agent,
  venue,
  approvedOutsideIdea,
  placeFirstOutsideTrade,
  acceptDisclosures,
  enableAutomaticTrading,
  askBuiltInTraderForIdea,
  pending,
  automaticTradingBusy,
}: {
  step: TradingLaunchStep;
  walletEncoded: string;
  agent: AgentProfile | null;
  venue: TradingLaunchVenue;
  approvedOutsideIdea?: AgentTradeProposal;
  placeFirstOutsideTrade: (proposal: AgentTradeProposal) => void;
  acceptDisclosures: () => void;
  enableAutomaticTrading: () => void;
  askBuiltInTraderForIdea: () => void;
  pending: boolean;
  automaticTradingBusy: boolean;
}): React.ReactNode {
  const base = `/app/wallet/${walletEncoded}/agents`;
  switch (step.id) {
    case "trader":
      return <StepLink href={`${base}/library`} label="Choose trader" />;
    case "plan":
      return (
        <StepLink
          href={agent ? `${base}/${encodeURIComponent(agent.id)}/strategy` : `${base}/library`}
          label="Review style"
        />
      );
    case "safety":
      return (
        <StepLink
          href={`${base}/policy?venue=${venue}&agent=${encodeURIComponent(agent?.id ?? "")}`}
          label="Set max loss"
        />
      );
    case "allowance":
      return (
        <StepLink
          href={`${base}/sessions/new?agent=${encodeURIComponent(agent?.id ?? "")}&venue=${venue}`}
          label="Set budget"
        />
      );
    case "disclosures":
      return (
        <button
          type="button"
          disabled={pending}
          onClick={acceptDisclosures}
          className={STEP_BUTTON_CLASS}
        >
          Accept disclosures
          <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      );
    case "automatic":
      return (
        <button
          type="button"
          disabled={pending || automaticTradingBusy || !agent}
          onClick={enableAutomaticTrading}
          className={STEP_BUTTON_CLASS}
        >
          {automaticTradingBusy ? "Turning on..." : "Start practice"}
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      );
    case "account":
    case "funding":
    case "protected_connection":
      return (
        <StepLink href={`${base}/hyperliquid`} label="Connect practice account" />
      );
    case "first_idea":
      if (agent?.kind === "mock") {
        return (
          <button
            type="button"
            disabled={pending}
            onClick={askBuiltInTraderForIdea}
            className={STEP_BUTTON_CLASS}
          >
            Ask for a practice idea
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      }
      return (
        <StepLink
          href={
            agent
              ? `${base}/${encodeURIComponent(agent.id)}/connection?venue=${venue}`
              : `${base}/library`
          }
          label="Connect trader"
        />
      );
    case "first_trade":
      if (venue === "hyperliquid_testnet" && approvedOutsideIdea) {
        return (
          <button
            type="button"
            disabled={pending}
            onClick={() => placeFirstOutsideTrade(approvedOutsideIdea)}
            className={STEP_BUTTON_CLASS}
          >
            Place first practice trade
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        );
      }
      if (venue === "mock_perps" && agent?.kind === "mock") {
        return <StepLink href={base} label="Review practice idea" />;
      }
      return (
        <StepLink
          href={
            agent
              ? `${base}/${encodeURIComponent(agent.id)}/connection?venue=${venue}`
              : `${base}/library`
          }
          label="Review first idea"
        />
      );
  }
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className={STEP_BUTTON_CLASS}>
      {label}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </Link>
  );
}

function ownerLabel(owner: TradingLaunchStep["owner"]): string {
  switch (owner) {
    case "you":
      return "You";
    case "trader":
      return "Trader";
    case "host":
      return "ClearSig";
    case "clearsig":
      return "ClearSig";
  }
}

function shortAddress(value: string): string {
  return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function mergeById<T extends { id: string; updatedAt?: number }>(
  local: T[],
  saved: T[],
): T[] {
  const merged = new Map<string, T>();
  for (const item of [...local, ...saved]) {
    const existing = merged.get(item.id);
    if (!existing || (item.updatedAt ?? 0) >= (existing.updatedAt ?? 0)) {
      merged.set(item.id, item);
    }
  }
  return [...merged.values()];
}

function sessionAllowsVenue(
  session: AgentSessionGrant,
  venue: TradingLaunchVenue,
  policy: AgentVaultPolicy,
): boolean {
  return session.allowedVenues?.length
    ? session.allowedVenues.includes(venue)
    : policy.allowedVenues.includes(venue);
}

async function loadStartMarketData({
  agent,
  venue,
}: {
  agent: AgentProfile;
  venue: TradingLaunchVenue;
}): Promise<{ snapshot: AgentMarketDataSnapshot | null; message: string }> {
  const market = agent.strategy?.allowedMarkets[0] ?? "BTC-PERP";
  const providers = venue === "hyperliquid_testnet" ? ["hyperliquid"] : ["hyperliquid", "mock"];
  for (const provider of providers) {
    try {
      const response = await fetch(
        `/api/agent-market-data/${provider}?market=${encodeURIComponent(market)}`,
        { cache: "no-store" },
      );
      const payload = (await response.json()) as {
        ok?: boolean;
        snapshot?: AgentMarketDataSnapshot;
        error?: string;
      };
      if (response.ok && payload.ok && payload.snapshot) {
        return {
          snapshot: payload.snapshot,
          message:
            payload.snapshot.source === "live"
              ? "Live market data is ready."
              : "Practice market data is ready.",
        };
      }
    } catch {
      // Try the next provider. The UI shows the fallback status below.
    }
  }
  return {
    snapshot: null,
    message: "Market data is not available yet. The trader can still use its practice plan.",
  };
}

function venueLabel(venue: TradingLaunchVenue | AgentExecutionRecord["venue"]): string {
  switch (venue) {
    case "mock_perps":
      return "Built-in practice";
    case "hyperliquid_testnet":
      return "Connected practice";
    case "bulktrade_mock":
      return "Bulk practice";
  }
}

function venueRequestStatusLabel(status: string): string {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "waiting_for_setup":
      return "Waiting for setup";
    case "adapter_not_connected":
      return "Connection pending";
    case "adapter_error":
      return "Executor error";
    case "rejected":
      return "Stopped";
    default:
      return status.replaceAll("_", " ");
  }
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  const abs = Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  });
  return `${parsed > 0 ? "+" : "-"}$${abs}`;
}

function formatCompactUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return `$${Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(parsed)}`;
}

const STEP_BUTTON_CLASS =
  "inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto";

const CONTROL_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60";

const DANGER_BUTTON_CLASS =
  "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-300 transition-colors hover:bg-rose-500/[0.08] disabled:cursor-not-allowed disabled:opacity-60";
