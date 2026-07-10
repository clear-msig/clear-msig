"use client";

import clsx from "clsx";
import { Clock, RefreshCw, X } from "lucide-react";
import { agentSessionPolicyBindingStatus, formatNumber, formatSignedUsd, formatUsd, venueLabel as tradingPlaceLabel, type AgentAuditEvent, type AgentProfile, type AgentSessionGrant, type AgentTradeProposal, type AgentVaultPolicy, type AgentKind, type AgentReadinessAction, type AgentTradingReadiness } from "@/features/agents/domain";
import { ActionButton } from "@/features/agents/ui/dashboard/ProposalPanels";

export function AuditEventRow({ event }: { event: AgentAuditEvent }) {
  return (
    <li className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 shadow-card-rest">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-text-strong">{event.message}</p>
        <span className="text-[11px] text-text-soft">
          {new Date(event.createdAt).toLocaleString()}
        </span>
      </div>
    </li>
  );
}
export function agentKindLabel(kind: AgentKind): string {
  switch (kind) {
    case "mock":
      return "Built-in practice trader";
    case "api":
      return "Connected trader";
    case "hermes":
      return "Independent trader";
    case "manual":
      return "Person";
  }
}
export function readinessSort(a: AgentTradingReadiness, b: AgentTradingReadiness): number {
  const weight = (status: AgentTradingReadiness["status"]) => {
    switch (status) {
      case "blocked":
        return 0;
      case "needs_setup":
        return 1;
      case "ready":
        return 2;
    }
  };
  const statusDelta = weight(a.status) - weight(b.status);
  return statusDelta !== 0 ? statusDelta : a.score - b.score;
}
export function readinessStatusTone(status: AgentTradingReadiness["status"]): string {
  switch (status) {
    case "ready":
      return "border-accent/30 bg-accent/[0.08] text-accent";
    case "blocked":
      return "border-rose-500/30 bg-rose-500/[0.08] text-rose-300";
    case "needs_setup":
      return "border-warning/30 bg-warning/[0.08] text-warning";
  }
}
export function readinessHref(
  walletEncoded: string,
  agentId: string,
  action: AgentReadinessAction,
): string {
  switch (action) {
    case "risk_limits":
      return `/app/wallet/${walletEncoded}/agents/policy`;
    case "strategy":
      return `/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agentId)}/strategy`;
    case "session":
      return `/app/wallet/${walletEncoded}/agents/sessions/new`;
    case "agent":
    case "none":
      return `/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agentId)}`;
  }
}
export function readinessActionLabel(action: AgentReadinessAction): string {
  switch (action) {
    case "risk_limits":
      return "Set safety";
    case "strategy":
      return "Review style";
    case "session":
      return "Set budget";
    case "agent":
      return "Review trader";
    case "none":
      return "View";
  }
}
export { formatNumber, formatSignedUsd, formatUsd, tradingPlaceLabel };
export function evidenceLabel(
  kind: NonNullable<AgentTradeProposal["decisionJournal"]>["evidence"][number]["kind"],
): string {
  switch (kind) {
    case "market_data":
      return "Market data";
    case "technical":
      return "Technical";
    case "fundamental":
      return "Fundamental";
    case "news":
      return "News";
    case "macro":
      return "Macro";
    case "strategy":
      return "Strategy";
    case "risk":
      return "Risk";
  }
}
export function formatAgentNoticeTime(value: number): string {
  const deltaMs = Date.now() - value;
  const minutes = Math.max(0, Math.round(deltaMs / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(value).toLocaleDateString();
}
export function SessionCard({
  session,
  agent,
  policy,
  pending,
  onRevoke,
  onRenew,
}: {
  session: AgentSessionGrant;
  agent?: AgentProfile;
  policy: AgentVaultPolicy | null;
  pending: boolean;
  onRevoke: (id: string) => void;
  onRenew: (id: string) => void;
}) {
  const timeActive = session.status === "active" && session.expiresAt > Date.now();
  const bindingStatus = policy
    ? agentSessionPolicyBindingStatus(session, policy)
    : "missing";
  const active = timeActive && bindingStatus === "current";
  const stale = timeActive && bindingStatus !== "current";
  const displayStatus = active
    ? "Active"
    : stale
      ? "Needs renewal"
      : session.status === "active" && session.expiresAt <= Date.now()
        ? "expired"
        : session.status;
  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Clock className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-strong">
              {agent?.name ?? "Unknown trader"}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                active
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : stale
                    ? "border-warning/30 bg-warning/[0.08] text-warning"
                    : "border-border-soft bg-canvas text-text-soft",
              )}
            >
              {displayStatus}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {session.allowedMarkets?.join(", ") || "Allowed markets"} ·{" "}
            ${session.maxNotionalUsd ?? "limit"} · {session.maxLeverage ?? "limit"}x
          </p>
          <p className="mt-2 text-[11px] text-text-soft">
            {stale
              ? "Your safety rules changed after this budget was set."
              : `Expires ${new Date(session.expiresAt).toLocaleString()}`}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {active ? (
              <ActionButton
                label="End budget"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => onRevoke(session.id)}
              />
            ) : (
              <ActionButton
                label="Renew budget"
                Icon={RefreshCw}
                disabled={pending}
                onClick={() => onRenew(session.id)}
              />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
