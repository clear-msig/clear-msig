"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowRight, AlertTriangle, Bell, Bot, Check, Info, Plug, Plus, RefreshCw, ShieldCheck, Sparkles, X } from "lucide-react";
import { type AgentProfile, type AgentNotification, type AgentTradingReadiness, type AgentKillSwitchHandoff, type AgentVenueReadiness } from "@/features/agents/domain";
import { formatAgentNoticeTime, readinessActionLabel, readinessHref, readinessStatusTone } from "@/features/agents/ui/dashboard/MetaPanels";

export function KillSwitchPanel({
  paused,
  pending,
  executorState,
  handoff,
  onToggle,
}: {
  paused: boolean;
  pending: boolean;
  executorState: "not_configured" | "unavailable" | "ready" | null;
  handoff: AgentKillSwitchHandoff | null;
  onToggle: (enabled: boolean) => void;
}) {
  const executorReady = executorState === "ready";
  return (
    <section
      className={clsx(
        "rounded-card border p-4 shadow-card-rest",
        paused
          ? "border-rose-500/30 bg-rose-500/[0.08]"
          : "border-border-soft bg-surface-raised",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              paused ? "bg-rose-500/[0.12] text-rose-300" : "bg-accent/10 text-accent",
            )}
          >
            {paused ? (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-strong">
              {paused ? "All automatic actions are stopped" : "Automatic actions are allowed"}
            </p>
            <p className="mt-1 text-xs text-text-soft">
              {paused
                ? executorReady
                  ? "Trading is paused. The connected account stop path is configured."
                  : "Trading is paused. Connected account stop path still needs setup."
                : executorReady
                  ? "Emergency stop can notify the connected practice account."
                  : "Emergency stop pauses ClearSig. Finish practice account setup for account handoff."}
            </p>
            <span
              className={clsx(
                "mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium",
                executorReady
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
                  : "border-warning/30 bg-warning/[0.08] text-warning",
              )}
            >
              Protected executor {executorReady ? "ready" : "pending"}
            </span>
          </div>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() => onToggle(!paused)}
          className={clsx(
            "inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border px-3 py-2 text-xs font-medium",
            "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            paused
              ? "border-accent/30 text-accent hover:bg-accent/[0.08]"
              : "border-rose-500/30 text-rose-300 hover:bg-rose-500/[0.08]",
          )}
        >
          {paused ? (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {paused ? "Allow trading again" : "Stop all trading"}
        </button>
      </div>
      {handoff ? (
        <div
          className={clsx(
            "mt-3 rounded-soft border px-3 py-2",
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
      ) : null}
    </section>
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
export function AgentNotificationsPanel({
  notifications,
  seenIds,
  unreadCount,
  critical,
  warning,
  onMarkSeen,
  onMarkAllSeen,
}: {
  notifications: AgentNotification[];
  seenIds: Set<string>;
  unreadCount: number;
  critical: number;
  warning: number;
  onMarkSeen: (id: string) => void;
  onMarkAllSeen: () => void;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              critical > 0
                ? "bg-rose-500/[0.10] text-rose-300"
                : warning > 0
                  ? "bg-warning/[0.08] text-warning"
                  : "bg-accent/10 text-accent",
            )}
          >
            <Bell className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Trading notifications
            </h2>
            <p className="mt-1 text-xs text-text-soft">
              {unreadCount > 0
                ? `${unreadCount} unread notice${unreadCount === 1 ? "" : "s"} need attention.`
                : "All current trading notices have been read."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-border-soft bg-canvas px-2.5 py-1 text-[11px] font-medium text-text-soft">
            {critical} urgent · {warning} warning
          </span>
          {unreadCount > 0 ? (
            <button
              type="button"
              onClick={onMarkAllSeen}
              className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
            >
              Mark all read
            </button>
          ) : null}
        </div>
      </div>

      {notifications.length === 0 ? (
        <div className="mt-4 rounded-soft border border-dashed border-border-soft bg-canvas px-3 py-3">
          <p className="text-xs font-semibold text-text-strong">
            No trading notices right now
          </p>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            Notices appear here when a trade needs approval, an idea is blocked,
            a trade opens or closes, a budget is near expiry, or marketplace
            review changes.
          </p>
        </div>
      ) : (
        <ul className="mt-4 grid gap-2">
          {notifications.slice(0, 5).map((notification) => {
            const seen = seenIds.has(notification.id);
            return (
              <li
                key={notification.id}
                className={clsx(
                  "rounded-soft border px-3 py-3",
                  seen
                    ? "border-border-soft bg-canvas"
                    : notification.severity === "critical"
                      ? "border-rose-500/30 bg-rose-500/[0.08]"
                      : notification.severity === "warning"
                        ? "border-warning/30 bg-warning/[0.08]"
                        : "border-accent/20 bg-accent/[0.05]",
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <Link
                    href={notification.href}
                    onClick={() => onMarkSeen(notification.id)}
                    className="min-w-0 flex-1"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold text-text-strong">
                        {notification.title}
                      </p>
                      {!seen ? (
                        <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-text-on-accent">
                          New
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-soft">
                      {notification.body}
                    </p>
                    <p className="mt-1 text-[11px] text-text-soft">
                      {formatAgentNoticeTime(notification.createdAt)}
                    </p>
                  </Link>
                  {!seen ? (
                    <button
                      type="button"
                      onClick={() => onMarkSeen(notification.id)}
                      className="inline-flex min-h-8 items-center justify-center rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
                    >
                      Read
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
export function LiveVenuePanel({
  readiness,
  loading,
  walletEncoded,
}: {
  readiness: AgentVenueReadiness | null;
  loading: boolean;
  walletEncoded: string;
}) {
  const connected =
    readiness?.state === "ready" &&
    readiness.executorProbe?.state === "ready" &&
    readiness.accountProbe?.state === "funded";
  const unavailable = !loading && !readiness;
  const reconciliation = readiness?.reconciliation ?? null;
  const title = loading
    ? "Checking practice account"
    : connected
      ? `${readiness.label} account connected`
      : readiness
        ? `${readiness.label} account needs setup`
        : "Practice account not connected";
  const summary = loading
    ? "Checking whether your trader can safely place trades."
    : connected
      ? "The account has practice funds and the protected trading connection is ready."
      : unavailable
        ? "The practice account check is unavailable right now."
        : readiness?.accountProbe?.state === "empty"
          ? "The account is connected, but it still needs practice funds."
          : readiness?.executorProbe?.state === "unavailable"
            ? "The account is known, but the protected trading connection could not be reached."
            : readiness?.executorProbe?.message ??
            readiness?.accountProbe?.message ??
            "Built-in practice works now. Connect a practice account when you are ready.";

  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
              connected
                ? "bg-accent/10 text-accent"
                : "bg-warning/[0.08] text-warning",
            )}
          >
            {connected ? (
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Plug className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-strong">
              Practice account
            </h2>
            <p className="mt-0.5 text-xs font-medium text-text-soft">
              {title}
            </p>
            <details className="group mt-1">
              <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">Practice account details</span>
              </summary>
              <p className="mt-1.5 max-w-2xl text-xs leading-relaxed text-text-soft">
                {summary}
              </p>
            </details>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={clsx(
              "rounded-full border px-2.5 py-1 text-[11px] font-medium",
              connected
                ? "border-accent/30 bg-accent/[0.08] text-accent"
                : "border-warning/30 bg-warning/[0.08] text-warning",
            )}
          >
            {loading ? "Checking" : connected ? "Connected" : "Needs setup"}
          </span>
          <Link
            href={`/app/wallet/${walletEncoded}/agents/hyperliquid`}
            className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
          >
            Set up Hyperliquid
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        </div>
      </div>
      {reconciliation ? (
        <div className="mt-4 grid gap-2 border-t border-border-soft pt-3 sm:grid-cols-4">
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Venue check
            </p>
            <p
              className={clsx(
                "mt-1 text-xs font-semibold",
                reconciliation.status === "healthy"
                  ? "text-accent"
                  : reconciliation.status === "blocked"
                    ? "text-danger"
                    : "text-warning",
              )}
            >
              {reconciliation.label}
            </p>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Submitted
            </p>
            <p className="mt-1 text-xs font-semibold text-text-strong">
              {reconciliation.submittedRequests}
            </p>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Live positions
            </p>
            <p className="mt-1 text-xs font-semibold text-text-strong">
              {reconciliation.exchangeOpenPositions}
            </p>
          </div>
          <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-text-soft">
              Mismatches
            </p>
            <p className="mt-1 text-xs font-semibold text-text-strong">
              {reconciliation.unmatchedPositions + reconciliation.missingOrderIds}
            </p>
          </div>
          {reconciliation.issues.length > 0 ? (
            <ul className="grid gap-2 sm:col-span-4 md:grid-cols-3">
              {reconciliation.issues.slice(0, 3).map((issue) => (
                <li
                  key={issue.id}
                  className={clsx(
                    "rounded-soft border px-3 py-2",
                    issue.severity === "block"
                      ? "border-rose-500/30 bg-rose-500/[0.08]"
                      : "border-warning/30 bg-warning/[0.08]",
                  )}
                >
                  <div className="flex items-center gap-2">
                    {issue.severity === "block" ? (
                      <X className="h-3.5 w-3.5 text-rose-300" aria-hidden="true" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />
                    )}
                    <p className="truncate text-xs font-semibold text-text-strong">
                      {issue.label}
                    </p>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-text-soft">
                    {issue.message}
                  </p>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
export function ReadinessRow({
  agent,
  readiness,
  walletEncoded,
}: {
  agent?: AgentProfile;
  readiness: AgentTradingReadiness;
  walletEncoded: string;
}) {
  const href = readinessHref(walletEncoded, readiness.agentId, readiness.primaryAction);
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-xs font-semibold text-text-strong">
              {agent?.name ?? "Trader"}
            </p>
            <span
              className={clsx(
                "rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                readinessStatusTone(readiness.status),
              )}
            >
              {readiness.score}% · {readiness.headline}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-text-soft">
            {readiness.summary}
          </p>
        </div>
        <Link
          href={href}
          className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
        >
          {readinessActionLabel(readiness.primaryAction)}
          <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
export function EmptyAgents({
  browseHref,
  createHref,
  pending,
  showDemo,
  onStartDemo,
}: {
  browseHref: string;
  createHref: string;
  pending: boolean;
  showDemo: boolean;
  onStartDemo: () => void;
}) {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-5 text-center shadow-card-rest">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Bot className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-4 font-display text-base font-semibold text-text-strong">
        No agents yet
      </p>
      <div className="mt-4 flex justify-center">
        <Link
          href={browseHref}
          className="inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
        >
          <Bot size={13} aria-hidden="true" />
          Choose trader
        </Link>
      </div>
      <details className="mt-3 text-center">
        <summary className="cursor-pointer text-xs font-medium text-text-soft hover:text-text-strong">
          More
        </summary>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Link
            href={createHref}
            className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong"
          >
            <Plus size={13} aria-hidden="true" />
            Create your own
          </Link>
          {showDemo ? (
            <button
              type="button"
              disabled={pending}
              onClick={onStartDemo}
              className="inline-flex items-center gap-1.5 rounded-soft border border-border-soft px-3 py-2 text-xs font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Sparkles size={13} aria-hidden="true" />
              Create sample activity
            </button>
          ) : null}
        </div>
      </details>
    </div>
  );
}
