"use client";

import { decodeRouteParam as decodeParam, formatNumber, formatSignedUsd, formatUsd, publicProfileUrl, venueLabel, type AgentAllocationRecommendation, type AgentKind, type AgentLeaderboardEntry, type AgentLibraryMetrics, type AgentModerationStatus, type AgentReadinessAction, type AgentProfile, type AgentProposalStatus, type AgentScorecard, type AgentTradingReadiness, type AgentTradingMode } from "@/features/agents/domain";

export { decodeParam, formatNumber, formatSignedUsd, formatUsd, venueLabel };
export function agentKindLabel(kind: AgentKind): string {
  switch (kind) {
    case "mock":
      return "Paper agent";
    case "api":
      return "API agent";
    case "hermes":
      return "Autonomous agent";
    case "manual":
      return "Manual trader";
  }
}
export function proposalStatusLabel(status: AgentProposalStatus): string {
  switch (status) {
    case "draft":
      return "Draft";
    case "blocked":
      return "Blocked";
    case "needs_approval":
      return "Needs approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "executed":
      return "Opened";
    case "expired":
      return "Expired";
  }
}
export function readinessBadgeTone(
  status: AgentTradingReadiness["status"],
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "ready":
      return "success";
    case "blocked":
      return "danger";
    case "needs_setup":
      return "warning";
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
      return "Set max loss";
    case "strategy":
      return "Review style";
    case "session":
      return "Set budget";
    case "agent":
      return "Details";
    case "none":
      return "Details";
  }
}
export function strategyModeLabel(mode: AgentTradingMode): string {
  switch (mode) {
    case "read_only":
      return "Read-only";
    case "paper":
      return "Paper trading";
    case "bounded_live":
      return "Bounded live";
    default:
      return "Strategy";
  }
}
export function allocationBadgeTone(
  action: AgentAllocationRecommendation["action"],
): "default" | "success" | "warning" | "danger" {
  switch (action) {
    case "promote":
      return "success";
    case "demote":
      return "danger";
    case "review":
      return "warning";
    case "hold":
    case "start":
      return "default";
  }
}
export function allocationActionLabel(
  action: AgentAllocationRecommendation["action"],
): string {
  switch (action) {
    case "promote":
      return "Raise budget";
    case "demote":
      return "Lower budget";
    case "hold":
      return "Keep budget";
    case "review":
      return "Review first";
    case "start":
      return "Start small";
  }
}
export function moderationLabel(status: AgentModerationStatus): string {
  switch (status) {
    case "pending_review":
      return "Pending review";
    case "approved":
      return "Approved";
    case "paused":
      return "Paused";
    case "delisted":
      return "Delisted";
  }
}
export function moderationBadgeTone(
  status: AgentModerationStatus | undefined,
): "default" | "success" | "warning" | "danger" {
  switch (status) {
    case "approved":
      return "success";
    case "delisted":
      return "danger";
    case "paused":
    case "pending_review":
    case undefined:
      return "warning";
  }
}
export function plainAllowanceSummary(
  recommendation: AgentAllocationRecommendation,
): string {
  const limits = recommendation.limits;
  const size = formatUsd(limits.maxNotionalUsd);
  const openTrades = `${limits.maxOpenPositions} open trade${limits.maxOpenPositions === 1 ? "" : "s"
    }`;
  const window = `${limits.sessionHours} hour${limits.sessionHours === 1 ? "" : "s"
    }`;
  const core = `${recommendation.tier.label}: up to ${size} per trade, ${limits.maxLeverage}x, ${openTrades}, for ${window}.`;
  switch (recommendation.action) {
    case "promote":
      return `This trader has earned a larger budget. ${core}`;
    case "demote":
      return `This trader should use a smaller budget next. ${core}`;
    case "hold":
      return `The current budget still fits this trader. ${core}`;
    case "review":
      return `Review the setup before giving more control. ${core}`;
    case "start":
      return `Start with a small human-approved budget. ${core}`;
  }
}
export function plainMetricText(value: string): string {
  return value
    .replace("executed trades", "completed trades")
    .replace("more executed trades", "more completed trades")
    .replace("trust score", "score")
    .replace("maximum drawdown", "largest fall")
    .replace("drawdown", "largest fall")
    .replace("violation rate", "stopped-idea rate")
    .replace("rule violations", "stopped ideas")
    .replace("human overrides", "manual changes")
    .replace("positive realized PnL", "positive profit/loss")
    .replace("PnL", "profit/loss");
}
export function publishedProfileText({
  agent,
  leaderboard,
  scorecard,
  openPositions,
  libraryMetrics,
  allocation,
}: {
  agent: AgentProfile;
  leaderboard?: AgentLeaderboardEntry;
  scorecard?: AgentScorecard;
  openPositions: number;
  libraryMetrics: AgentLibraryMetrics | null;
  allocation: AgentAllocationRecommendation | null;
}): string {
  const publishing = agent.publishing;
  return [
    `${agent.name} by ClearSig`,
    publishing?.publicSummary ?? agent.description ?? "Published agent profile",
    "",
    `Profile: ${publicProfileUrl(agent.walletName, publishing?.slug ?? agent.id)}`,
    `Status: ${agent.status}`,
    `Marketplace review: ${moderationLabel(publishing?.moderation?.status ?? "pending_review")}`,
    `Score: ${leaderboard?.score ?? 50}`,
    `Profit/loss: ${formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")}`,
    `Closed trades: ${libraryMetrics?.closedTrades ?? 0}`,
    `Open trades: ${openPositions}`,
    `Win rate: ${libraryMetrics?.winRatePct == null ? "New" : `${libraryMetrics.winRatePct}%`
    }`,
    `Safety stops: ${scorecard?.ruleViolations ?? 0}`,
    `Budget level: ${allocation?.tier.label ?? "Probation"}`,
  ].join("\n");
}
export function cleanOptional(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
export function formatShortDate(value: number): string {
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
export function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}
export const PROFILE_INPUT_CLASS =
  "min-h-10 w-full rounded-soft border border-border-soft bg-canvas px-3 py-2 text-sm text-text-strong placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25";
