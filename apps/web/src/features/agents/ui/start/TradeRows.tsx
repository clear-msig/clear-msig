"use client";

import { useState } from "react";
import clsx from "clsx";
import { AlertTriangle, Check, Clock, Circle, X } from "lucide-react";
import { estimateAgentOpenTradePerformance, type AgentExecutionRecord, type AgentKillSwitchHandoff, type AgentMarketDataSnapshot, type AgentTradeLifecycle, type AgentVenueReadiness } from "@/features/agents/domain";
import { CONTROL_BUTTON_CLASS, formatSignedUsd, formatUsd, venueLabel } from "@/features/agents/ui/start/presentation";
import { ControlStat } from "@/features/agents/ui/start/VenueRows";

export function OpenTradeRow({
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
            aria-label="Profit or loss in USD"
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
export function TradeLifecycleRow({ lifecycle }: { lifecycle: AgentTradeLifecycle }) {
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
export function KillSwitchHandoffCard({ handoff }: { handoff: AgentKillSwitchHandoff }) {
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
export function killSwitchHandoffLabel(handoff: AgentKillSwitchHandoff): string {
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
export function VenuePositionRow({
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
export function lifecycleToneClass(tone: AgentTradeLifecycle["tone"]): string {
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
      return "border-border-soft bg-surface-raised text-text-soft";
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
      return Circle;
  }
}
