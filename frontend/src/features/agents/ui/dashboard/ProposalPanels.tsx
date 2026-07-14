"use client";

import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Check, Clock, Info, Plug, Play, RefreshCw, ShieldCheck, X } from "lucide-react";
import { canOpenLocalAgentExecution, estimateAgentOpenTradePerformance, executionUnavailableReason, type AgentExecutionRecord, type AgentTradeProposal, type AgentMarketDataSnapshot, type AgentTradeLifecycle } from "@/features/agents/domain";
import { evidenceLabel, formatNumber, formatSignedUsd, formatUsd, tradingPlaceLabel } from "@/features/agents/ui/dashboard/MetaPanels";
import { ScoreStat } from "@/features/agents/ui/dashboard/AgentCards";

export function AgentClearSignProof({ proposal }: { proposal: AgentTradeProposal }) {
  const proof = proposal.clearSignV2;
  if (!proof) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 rounded-soft border border-accent/20 bg-accent/[0.05] px-2 py-1.5 text-[10px] font-medium text-text-soft">
      <span className="inline-flex items-center gap-1 text-accent">
        <ShieldCheck className="h-3 w-3" aria-hidden="true" />
        ClearSign v3
      </span>
      <span className="font-mono">payload {proof.payloadHash.slice(0, 10)}</span>
      <span className="font-mono">risk {proof.payload.riskCheckHash.slice(0, 10)}</span>
    </div>
  );
}
export function TradeLifecycleStrip({ lifecycle }: { lifecycle: AgentTradeLifecycle }) {
  return (
    <div className="mt-3 grid gap-1.5 sm:grid-cols-5">
      {lifecycle.steps.map((step) => {
        const Icon = lifecycleStepIcon(step.status);
        return (
          <div
            key={step.id}
            title={step.detail}
            className={clsx(
              "flex min-h-10 items-center gap-2 rounded-soft border px-2 py-1.5",
              lifecycleStepClass(step.status),
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <p className="truncate text-[11px] font-semibold">{step.label}</p>
              <p className="truncate text-[10px] opacity-75">{step.detail}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
export function DecisionJournalSummary({ proposal }: { proposal: AgentTradeProposal }) {
  const journal = proposal.decisionJournal;
  if (!journal) return null;
  return (
    <div className="mt-3 rounded-soft border border-border-soft bg-canvas p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] font-semibold text-text-strong">
          Why this trade
        </p>
        <details className="group">
          <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
            <Info className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="sr-only">Decision details</span>
          </summary>
          <div className="mt-2 grid gap-1.5 sm:grid-cols-3">
            <MiniReason label="Risk" value={journal.riskPlan} />
            <MiniReason label="Exit" value={journal.exitPlan} />
            <MiniReason label="Checks" value={journal.policySummary} />
          </div>
          {journal.evidence.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {journal.evidence.slice(0, 4).map((item) => (
                <span
                  key={item.id}
                  className="rounded-full border border-border-soft bg-surface-raised px-2 py-0.5 text-[10px] font-medium text-text-soft"
                >
                  {evidenceLabel(item.kind)}
                </span>
              ))}
            </div>
          ) : null}
        </details>
      </div>
      <p className="mt-1 line-clamp-1 text-xs text-text-soft">
        {journal.summary}
      </p>
    </div>
  );
}
export function lifecycleToneClass(tone: AgentTradeLifecycle["tone"]): string {
  switch (tone) {
    case "success":
      return "border-accent/30 bg-accent/[0.08] text-accent";
    case "warning":
      return "border-warning/30 bg-warning/[0.08] text-warning";
    case "danger":
      return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
    case "default":
      return "border-border-soft bg-canvas text-text-soft";
  }
}
export function lifecycleStepClass(status: AgentTradeLifecycle["steps"][number]["status"]): string {
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
      return "border-border-soft bg-canvas text-text-soft";
  }
}
export function lifecycleStepIcon(
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
      return Clock;
  }
}
export function MiniReason({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-soft border border-border-soft bg-surface-raised px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-text-strong">
        {value}
      </p>
    </div>
  );
}
export function ProposalActions({
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
            label="Open guarded trade"
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
  );
}
export function ActionButton({
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
export function ExecutionCard({
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
                aria-label="Profit or loss in USD"
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
