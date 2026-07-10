"use client";

import Link from "next/link";
import { ArrowLeft, Bot, Check, Clock, Inbox, Lock, PencilLine, Plug, Play, RefreshCw, Send, ShieldCheck, Trophy, X } from "lucide-react";
import { useAgentDetailController } from "@/features/agents/controllers/useAgentDetailController";
import { ActionButton, Badge, EmptyLine, EntitySection, ExecutionRow, LinkButton, ProposalRow, SessionRow } from "@/features/agents/ui/detail/EntityRows";
import { PROFILE_INPUT_CLASS, agentKindLabel, formatNumber, formatShortDate, formatSignedUsd, strategyModeLabel } from "@/features/agents/ui/detail/presentation";
import { AllowanceDecisionPanel, Metric, Panel, PublishingPanel, ReadinessPanel } from "@/features/agents/ui/detail/OverviewPanels";
import { InfoRow, KillSwitchPanel, NextAllowancePanel, RecentTradesPanel, ScoreBreakdownPanel, ScoreRow, StoppedIdeasPanel } from "@/features/agents/ui/detail/PerformancePanels";

export function AgentDetailScreen({ controller }: { controller: ReturnType<typeof useAgentDetailController> }) {
  if ("notFound" in controller) return controller.notFound;
  const {
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
  } = controller;
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
                  aria-label="Trader name"
                  value={agentNameDraft}
                  onChange={(event) => setAgentNameDraft(event.target.value)}
                  className={PROFILE_INPUT_CLASS}
                />
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-text-soft">Description</span>
                <textarea
                  aria-label="Trader description"
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
                    aria-label="Trader connection URL"
                    value={agentEndpointDraft}
                    onChange={(event) => setAgentEndpointDraft(event.target.value)}
                    className={PROFILE_INPUT_CLASS}
                  />
                </label>
                <label className="grid gap-1.5">
                  <span className="text-xs font-medium text-text-soft">Public identity</span>
                  <input
                    aria-label="Trader public identity"
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
