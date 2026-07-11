"use client";

import clsx from "clsx";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Play, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { type TradingLaunchVenue } from "@/features/agents/domain";
import { useStartTradingController } from "@/features/agents/controllers/useStartTradingController";
import { BetaJourneyPanel, LaunchStepRow, PrimaryLaunchActionPanel } from "@/features/agents/ui/start/JourneyPanels";
import { actionForStep } from "@/features/agents/ui/start/VenueRows";
import { STEP_BUTTON_CLASS } from "@/features/agents/ui/start/presentation";

const TradingControlRoom = dynamic(
  () =>
    import("@/features/agents/ui/start/ControlRoom").then(
      (module) => module.TradingControlRoom,
    ),
  {
    loading: () => (
      <section
        className="min-h-[20rem] animate-pulse rounded-card border border-border-soft bg-surface-raised"
        aria-label="Loading trading controls"
        aria-busy="true"
      />
    ),
  },
);
const OwnerApprovalDialog = dynamic(
  () =>
    import("@/components/agents/OwnerApprovalDialog").then(
      (module) => module.OwnerApprovalDialog,
    ),
  { ssr: false },
);
const ComplianceDisclosurePanel = dynamic(
  () =>
    import("@/features/agents/ui/start/DisclosurePanels").then(
      (module) => module.ComplianceDisclosurePanel,
    ),
  {
    loading: () => (
      <section
        className="min-h-32 animate-pulse rounded-card border border-border-soft bg-surface-raised"
        aria-label="Loading trading disclosures"
        aria-busy="true"
      />
    ),
  },
);
const AutomaticTradingStatus = dynamic(
  () =>
    import("@/features/agents/ui/start/DisclosurePanels").then(
      (module) => module.AutomaticTradingStatus,
    ),
  {
    loading: () => (
      <li
        className="min-h-10 animate-pulse rounded-soft border border-border-soft bg-canvas"
        aria-label="Loading automation status"
        aria-busy="true"
      />
    ),
  },
);
const HyperliquidHelp = dynamic(
  () =>
    import("@/features/agents/ui/start/DisclosurePanels").then(
      (module) => module.HyperliquidHelp,
    ),
  {
    loading: () => (
      <section
        className="min-h-40 animate-pulse rounded-card border border-border-soft bg-surface-raised"
        aria-label="Loading practice account"
        aria-busy="true"
      />
    ),
  },
);
const LaunchRiskPanel = dynamic(
  () =>
    import("@/features/agents/ui/start/LaunchRiskPanel").then(
      (module) => module.LaunchRiskPanel,
    ),
  {
    loading: () => (
      <section
        className="min-h-32 animate-pulse rounded-card border border-border-soft bg-surface-raised"
        aria-label="Loading safety checks"
        aria-busy="true"
      />
    ),
  },
);

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

export function StartTradingScreen({ controller }: { controller: ReturnType<typeof useStartTradingController> }) {
  const {
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
  } = controller;
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
          setupSettings={setupSettings}
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
