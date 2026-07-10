"use client";

import clsx from "clsx";
import { AlertTriangle, Pause, X } from "lucide-react";
import { type AgentAuditEvent, type AgentExecutionRecord, type AgentKillSwitchHandoff, type AgentMarketDataSnapshot, type AgentProfile, type AgentSessionGrant, type AgentTradeLifecycle, type AgentTradeLifecycleSummary, type TradingLaunchVenue, type AgentVenueReadiness } from "@/features/agents/domain";
import { CONTROL_BUTTON_CLASS, DANGER_BUTTON_CLASS, formatCompactUsd, formatSignedUsd, formatUsd } from "@/features/agents/ui/start/presentation";
import { ControlStat, EmptyControlLine, VenueRequestRow } from "@/features/agents/ui/start/VenueRows";
import { KillSwitchHandoffCard, OpenTradeRow, TradeLifecycleRow, VenuePositionRow } from "@/features/agents/ui/start/TradeRows";

export function TradingControlRoom({
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
export function CollapsibleControlPanel({
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
