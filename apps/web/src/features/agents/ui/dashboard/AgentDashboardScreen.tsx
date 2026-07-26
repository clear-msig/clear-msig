"use client";

import clsx from "clsx";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Bot, BrainCircuit, ChevronDown, CircleDollarSign, ClipboardList, KeyRound, Lock, MessageSquare, Play, Send, ShieldCheck, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useAgentDashboardController } from "@/features/agents/controllers/useAgentDashboardController";
import { DeskStatus, FeatureAccessPanel, GettingStartedPanel, MarketIntelligencePanel, ReadinessPanel, ScoutPanel } from "@/features/agents/ui/dashboard/SetupPanels";
import { AgentNotificationsPanel, EmptyAgents, KillSwitchPanel, LiveVenuePanel } from "@/features/agents/ui/dashboard/OperationsPanels";
import { BackendPersistencePanel, BetaReadinessPanel, MarketReadinessPanel, OpenTradeMonitor } from "@/features/agents/ui/dashboard/ReadinessPanels";
import { AgentCard, ProposalCard } from "@/features/agents/ui/dashboard/AgentCards";
import { AuditEventRow, SessionCard } from "@/features/agents/ui/dashboard/MetaPanels";
import { ExecutionCard } from "@/features/agents/ui/dashboard/ProposalPanels";

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

export function AgentDashboardScreen({ controller }: { controller: ReturnType<typeof useAgentDashboardController> }) {
  const {
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
  } = controller;
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
              Practice perps
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
        <div className="mt-5 grid gap-2 sm:grid-cols-3">
          <DeskStatus label="Trader" value={activeAgents ? "Chosen" : "Needed"} tone={activeAgents ? "accent" : "warn"} />
          <DeskStatus label="Mode" value="Practice" tone="soft" />
          <DeskStatus
            label="Safety"
            value={policy?.enabled ? "On" : "Needed"}
            tone={policy?.enabled ? "accent" : "warn"}
          />
        </div>
      </header>

      {!setupComplete ? (
        <GettingStartedPanel steps={gettingStartedSteps} walletEncoded={encoded} />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-text-strong">
                    Trading remote
                  </p>
                  <p className="mt-0.5 text-xs text-text-soft">
                    Open practice trading. More controls stay folded until needed.
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
                  href={`/app/wallet/${encoded}/agents/library`}
                  className={agentToolClass}
                >
                  <Bot size={15} aria-hidden="true" />
                  <span>Choose trader</span>
                </Link>
                <Link
                  href={`/app/wallet/${encoded}/agents/policy`}
                  className={agentToolClass}
                >
                  <ShieldCheck size={15} aria-hidden="true" />
                  <span>Safety</span>
                </Link>
                <Link
                  href={`/app/wallet/${encoded}/agents/funding`}
                  className={agentToolClass}
                >
                  <CircleDollarSign size={15} aria-hidden="true" />
                  <span>Budget</span>
                </Link>
                {canRunAutonomyScan ? (
                  <button
                    type="button"
                    disabled={pendingAction}
                    title="Scan current markets through active rules"
                    onClick={runAutonomyScan}
                    className={agentToolClass}
                  >
                    <BrainCircuit size={15} aria-hidden="true" />
                    <span>Run scan</span>
                  </button>
                ) : null}
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

          {policy?.emergencyPaused ? (
            <section id="kill-switch" className="scroll-mt-24">
              <KillSwitchPanel
                paused={policy.emergencyPaused}
                pending={pendingAction}
                executorState={liveVenueReadiness?.executorProbe?.state ?? null}
                handoff={killSwitchHandoff}
                onToggle={setKillSwitch}
              />
            </section>
          ) : policy ? (
            <details
              id="kill-switch"
              className="group rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text-strong">
                <span className="inline-flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-accent" aria-hidden="true" />
                  Safety controls
                </span>
                <ChevronDown
                  className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <div className="mt-3">
                <KillSwitchPanel
                  paused={policy.emergencyPaused}
                  pending={pendingAction}
                  executorState={liveVenueReadiness?.executorProbe?.state ?? null}
                  handoff={killSwitchHandoff}
                  onToggle={setKillSwitch}
                />
              </div>
            </details>
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

          <details className="group rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text-strong">
              <span className="inline-flex items-center gap-2">
                <SlidersHorizontal className="h-4 w-4 text-accent" aria-hidden="true" />
                Details
              </span>
              <ChevronDown
                className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-3 flex flex-col gap-4">
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
                  <Link
                    href={`/app/wallet/${encoded}/agents/start`}
                    className="flex items-center justify-between gap-3 rounded-card border border-dashed border-border-soft bg-surface-raised p-4 text-sm text-text-soft transition-colors hover:border-accent/50 hover:text-text-strong"
                  >
                    <span>No trade ideas yet.</span>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                      Start practice
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </span>
                  </Link>
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
            </div>
          </details>

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
            <details className="group rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest sm:p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold text-text-strong">
                <span>Agent log</span>
                <ChevronDown
                  className="h-4 w-4 text-text-soft transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>
              <ul className="mt-3 grid gap-2">
                {events.slice(0, 6).map((event) => (
                  <AuditEventRow key={event.id} event={event} />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
    </motion.div>
  );
}
