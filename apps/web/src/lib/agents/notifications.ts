import type {
  AgentAuditEvent,
  AgentExecutionRecord,
  AgentModerationStatus,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

export type AgentNotificationSeverity = "critical" | "warning" | "info";
export type AgentNotificationKind =
  | "trade_needs_approval"
  | "trade_blocked"
  | "trade_open"
  | "trade_closed"
  | "allowance_expiring"
  | "publishing_review"
  | "kill_switch"
  | "owner_action";

export interface AgentNotification {
  id: string;
  walletName: string;
  agentId?: string;
  kind: AgentNotificationKind;
  severity: AgentNotificationSeverity;
  title: string;
  body: string;
  href: string;
  createdAt: number;
  sourceId: string;
}

export interface AgentNotificationSummary {
  notifications: AgentNotification[];
  critical: number;
  warning: number;
  info: number;
}

const SEEN_STORAGE_PREFIX = "clear.agent-notifications.seen.v1.";
const CHANGE_EVENT = "clear:agent-notifications-changed";
const MAX_SEEN_IDS = 500;

export function buildAgentNotifications({
  walletName,
  walletHref,
  agents,
  proposals,
  sessions,
  executions,
  events,
  policy,
  now = Date.now(),
}: {
  walletName: string;
  walletHref: string;
  agents: AgentProfile[];
  proposals: AgentTradeProposal[];
  sessions: AgentSessionGrant[];
  executions: AgentExecutionRecord[];
  events: AgentAuditEvent[];
  policy?: AgentVaultPolicy | null;
  now?: number;
}): AgentNotificationSummary {
  const byAgent = new Map(agents.map((agent) => [agent.id, agent]));
  const notifications: AgentNotification[] = [
    ...proposals.flatMap((proposal) =>
      proposalNotifications({ proposal, agent: byAgent.get(proposal.agentId), walletHref }),
    ),
    ...executions.flatMap((execution) =>
      executionNotifications({ execution, agent: byAgent.get(execution.agentId), walletHref }),
    ),
    ...sessions.flatMap((session) =>
      sessionNotifications({ session, agent: byAgent.get(session.agentId), walletHref, now }),
    ),
    ...agents.flatMap((agent) => publishingNotifications({ agent, walletHref, now })),
    ...events.flatMap((event) => eventNotifications({ event, policy, walletHref })),
  ];
  const deduped = dedupeNotifications(notifications)
    .filter((item) => item.walletName === walletName)
    .sort(notificationSort)
    .slice(0, 20);
  return {
    notifications: deduped,
    critical: deduped.filter((item) => item.severity === "critical").length,
    warning: deduped.filter((item) => item.severity === "warning").length,
    info: deduped.filter((item) => item.severity === "info").length,
  };
}

export function readSeenAgentNotificationIds(walletName: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(seenKey(walletName));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export function markAgentNotificationSeen(walletName: string, id: string): void {
  writeSeen(walletName, new Set([...readSeenAgentNotificationIds(walletName), id]));
}

export function markAllAgentNotificationsSeen(
  walletName: string,
  ids: string[],
): void {
  writeSeen(walletName, new Set([...readSeenAgentNotificationIds(walletName), ...ids]));
}

export function subscribeAgentNotifications(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

function proposalNotifications({
  proposal,
  agent,
  walletHref,
}: {
  proposal: AgentTradeProposal;
  agent?: AgentProfile;
  walletHref: string;
}): AgentNotification[] {
  if (proposal.status === "needs_approval") {
    return [
      notification({
        id: `proposal-needs-approval:${proposal.id}`,
        walletName: proposal.walletName,
        agentId: proposal.agentId,
        kind: "trade_needs_approval",
        severity: "critical",
        title: `${agent?.name ?? "Trader"} needs approval`,
        body: `${proposal.side.toUpperCase()} ${proposal.market} for ${formatUsd(proposal.notionalUsd)} is waiting for owner approval.`,
        href: `${walletHref}/agents/${encodeURIComponent(proposal.agentId)}`,
        createdAt: proposal.updatedAt,
        sourceId: proposal.id,
      }),
    ];
  }
  if (proposal.status === "blocked") {
    const reason = proposal.policyViolations?.[0]?.message;
    return [
      notification({
        id: `proposal-blocked:${proposal.id}`,
        walletName: proposal.walletName,
        agentId: proposal.agentId,
        kind: "trade_blocked",
        severity: "warning",
        title: "Trade idea stopped by ClearSig",
        body:
          reason ??
          `${proposal.market} did not fit the active allowance or safety rules.`,
        href: `${walletHref}/agents/${encodeURIComponent(proposal.agentId)}`,
        createdAt: proposal.updatedAt,
        sourceId: proposal.id,
      }),
    ];
  }
  return [];
}

function executionNotifications({
  execution,
  agent,
  walletHref,
}: {
  execution: AgentExecutionRecord;
  agent?: AgentProfile;
  walletHref: string;
}): AgentNotification[] {
  if (execution.status === "open") {
    return [
      notification({
        id: `execution-open:${execution.id}`,
        walletName: execution.walletName,
        agentId: execution.agentId,
        kind: "trade_open",
        severity: "info",
        title: `${agent?.name ?? "Trader"} has an open trade`,
        body: `${execution.side.toUpperCase()} ${execution.market} is open for ${formatUsd(execution.notionalUsd)}.`,
        href: `${walletHref}/agents/trades`,
        createdAt: execution.openedAt,
        sourceId: execution.id,
      }),
    ];
  }
  const pnl = Number(execution.realizedPnlUsd || 0);
  return [
    notification({
      id: `execution-closed:${execution.id}`,
      walletName: execution.walletName,
      agentId: execution.agentId,
      kind: "trade_closed",
      severity: pnl < 0 ? "warning" : "info",
      title: `${execution.market} trade closed`,
      body: `Realized P/L ${formatSignedUsd(execution.realizedPnlUsd)}.`,
      href: `${walletHref}/agents/trades`,
      createdAt: execution.closedAt ?? execution.openedAt,
      sourceId: execution.id,
    }),
  ];
}

function sessionNotifications({
  session,
  agent,
  walletHref,
  now,
}: {
  session: AgentSessionGrant;
  agent?: AgentProfile;
  walletHref: string;
  now: number;
}): AgentNotification[] {
  const expiresSoon = session.status === "active" && session.expiresAt <= now + 2 * 60 * 60_000;
  if (!expiresSoon) return [];
  return [
    notification({
      id: `allowance-expiring:${session.id}`,
      walletName: session.walletName,
      agentId: session.agentId,
      kind: "allowance_expiring",
      severity: "warning",
      title: `${agent?.name ?? "Trader"} allowance expires soon`,
      body: `Automatic trading permission expires ${relativeShort(session.expiresAt, now)}.`,
      href: `${walletHref}/agents/${encodeURIComponent(session.agentId)}`,
      createdAt: now,
      sourceId: session.id,
    }),
  ];
}

function publishingNotifications({
  agent,
  walletHref,
  now,
}: {
  agent: AgentProfile;
  walletHref: string;
  now: number;
}): AgentNotification[] {
  const status = agent.publishing?.moderation?.status;
  if (!agent.publishing || status === "approved" || agent.publishing.status !== "published") {
    return [];
  }
  return [
    notification({
      id: `publishing-review:${agent.id}:${status ?? "pending_review"}`,
      walletName: agent.walletName,
      agentId: agent.id,
      kind: "publishing_review",
      severity: status === "delisted" || status === "paused" ? "warning" : "info",
      title: `${agent.name} marketplace status: ${moderationLabel(status)}`,
      body:
        agent.publishing.moderation?.reason ??
        "Marketplace review must approve this profile before public discovery.",
      href: `${walletHref}/agents/${encodeURIComponent(agent.id)}#publishing`,
      createdAt: agent.publishing.moderation?.updatedAt ?? agent.publishing.updatedAt ?? now,
      sourceId: agent.id,
    }),
  ];
}

function eventNotifications({
  event,
  policy,
  walletHref,
}: {
  event: AgentAuditEvent;
  policy?: AgentVaultPolicy | null;
  walletHref: string;
}): AgentNotification[] {
  if (event.kind === "policy_emergency_pause_changed" && policy?.emergencyPaused) {
    return [
      notification({
        id: `kill-switch:${event.id}`,
        walletName: event.walletName,
        agentId: event.agentId,
        kind: "kill_switch",
        severity: "critical",
        title: "All automatic trading is stopped",
        body: event.message,
        href: `${walletHref}/agents`,
        createdAt: event.createdAt,
        sourceId: event.id,
      }),
    ];
  }
  if (event.kind === "owner_action_approved") {
    return [
      notification({
        id: `owner-action:${event.id}`,
        walletName: event.walletName,
        agentId: event.agentId,
        kind: "owner_action",
        severity: "info",
        title: "Owner approval recorded",
        body: event.message,
        href: event.agentId
          ? `${walletHref}/agents/${encodeURIComponent(event.agentId)}`
          : `${walletHref}/agents/approvals`,
        createdAt: event.createdAt,
        sourceId: event.id,
      }),
    ];
  }
  return [];
}

function notification(input: AgentNotification): AgentNotification {
  return input;
}

function dedupeNotifications(items: AgentNotification[]): AgentNotification[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function notificationSort(a: AgentNotification, b: AgentNotification): number {
  return severityWeight(b.severity) - severityWeight(a.severity) || b.createdAt - a.createdAt;
}

function severityWeight(severity: AgentNotificationSeverity): number {
  switch (severity) {
    case "critical":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function writeSeen(walletName: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      seenKey(walletName),
      JSON.stringify(Array.from(ids).slice(-MAX_SEEN_IDS)),
    );
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* private-mode or quota failures should not break trading */
  }
}

function seenKey(walletName: string): string {
  return `${SEEN_STORAGE_PREFIX}${walletName}`;
}

function moderationLabel(status: AgentModerationStatus | undefined): string {
  switch (status) {
    case "approved":
      return "approved";
    case "paused":
      return "paused";
    case "delisted":
      return "delisted";
    case "pending_review":
    default:
      return "pending review";
  }
}

function relativeShort(timestamp: number, now: number): string {
  const minutes = Math.max(0, Math.round((timestamp - now) / 60_000));
  if (minutes < 60) return `in ${minutes}m`;
  return `in ${Math.round(minutes / 60)}h`;
}

function formatUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(parsed);
}

function formatSignedUsd(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return "$0";
  const formatted = formatUsd(Math.abs(parsed));
  if (parsed > 0) return `+${formatted}`;
  if (parsed < 0) return `-${formatted}`;
  return formatted;
}
