"use client";

import clsx from "clsx";
import Link from "next/link";
import { ArrowRight, Bot, Check, Clock, Inbox, Info, Plug, Play, RefreshCw, Send, SlidersHorizontal, Trophy, X } from "lucide-react";
import { buildAgentTradeLifecycle, type AgentExecutionRecord, type AgentLeaderboardEntry, type AgentProfile, type AgentScorecard, type AgentTradeProposal, type AgentAllocationRecommendation, type AgentInboxSummary, type AgentVenueRequestRecord, type HyperliquidTestnetAccountSnapshot } from "@/features/agents/domain";
import { agentKindLabel, formatNumber, formatSignedUsd, tradingPlaceLabel } from "@/features/agents/ui/dashboard/MetaPanels";
import { ActionButton, AgentClearSignProof, DecisionJournalSummary, ProposalActions, TradeLifecycleStrip, lifecycleToneClass } from "@/features/agents/ui/dashboard/ProposalPanels";

export function AgentCard({
  agent,
  walletEncoded,
  rank,
  leaderboard,
  scorecard,
  allocation,
  inboxSummary,
  pending,
  onStatusChange,
}: {
  agent: AgentProfile;
  walletEncoded: string;
  rank: number;
  leaderboard?: AgentLeaderboardEntry;
  scorecard?: AgentScorecard;
  allocation?: AgentAllocationRecommendation;
  inboxSummary?: AgentInboxSummary;
  pending: boolean;
  onStatusChange: (id: string, status: AgentProfile["status"]) => void;
}) {
  const statusTone =
    agent.status === "active"
      ? "border-accent/30 bg-accent/[0.08] text-accent"
      : agent.status === "paused"
        ? "border-warning/30 bg-warning/[0.08] text-warning"
        : "border-rose-500/30 bg-rose-500/[0.08] text-rose-500";
  const published = agent.publishing?.status === "published";

  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Bot className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate text-sm font-semibold text-text-strong">
              {agent.name}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                statusTone,
              )}
            >
              {agent.status}
            </span>
            {published ? (
              <span className="inline-flex items-center rounded-full border border-accent/30 bg-accent/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-accent">
                Published
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-xs capitalize text-text-soft">
            {agentKindLabel(agent.kind)}
          </p>
          {agent.description ? (
            <details className="group mt-1">
              <summary className="inline-flex h-7 w-7 cursor-pointer list-none items-center justify-center rounded-full text-text-soft transition-colors hover:bg-glass-mid hover:text-accent">
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="sr-only">{agent.name} profile</span>
              </summary>
              <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-soft">
                {agent.description}
              </p>
            </details>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft">
              <Trophy className="h-3 w-3" aria-hidden="true" />
              {rank > 0 ? `Rank #${rank}` : "Unranked"}
            </span>
            <span className="inline-flex items-center rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft">
              Safety score {leaderboard?.score ?? 50}
            </span>
            <span
              className={clsx(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                inboxSummary?.count
                  ? "border-warning/30 bg-warning/[0.08] text-warning"
                  : "border-border-soft bg-canvas text-text-soft",
              )}
            >
              <Inbox className="h-3 w-3" aria-hidden="true" />
              {inboxSummary?.status === "unavailable"
                ? "Ideas unavailable"
                : `${inboxSummary?.count ?? 0} new`}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <ScoreStat label="Profit/loss" value={formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")} />
            <ScoreStat label="Trades" value={String(scorecard?.executed ?? 0)} />
            <ScoreStat label="Stopped" value={String(scorecard?.ruleViolations ?? 0)} />
            <ScoreStat
              label="Largest fall"
              value={`${formatNumber(scorecard?.maxDrawdownPct ?? 0)}%`}
            />
          </div>
          {allocation ? (
            <div className="mt-3 border-t border-border-soft pt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-text-strong">
                    Recommended budget
                  </p>
                  <p className="mt-1 line-clamp-1 text-xs text-text-soft">
                    {allocation.summary}
                  </p>
                </div>
                <span
                  className={clsx(
                    "rounded-full border px-2 py-0.5 text-[10px] font-medium capitalize",
                    allocation.action === "demote"
                      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-300"
                      : allocation.action === "promote"
                        ? "border-accent/30 bg-accent/[0.08] text-accent"
                        : "border-border-soft bg-canvas text-text-soft",
                  )}
                >
                  {allocation.action} · {allocation.tier.label}
                </span>
              </div>
              {allocation.nextTier && allocation.nextTierGaps.length > 0 ? (
                <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-text-soft">
                  Next level: {allocation.nextTier.label} needs{" "}
                  {allocation.nextTierGaps.slice(0, 2).join(" and ")}.
                </p>
              ) : null}
              {agent.status === "active" ? (
                <Link
                  href={`/app/wallet/${walletEncoded}/agents/sessions/new?agent=${encodeURIComponent(agent.id)}&allocationTier=${allocation.tier.id}`}
                  className="mt-2 inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  Review budget
                </Link>
              ) : null}
            </div>
          ) : null}
          {agent.publishing?.status === "published" ? (
            <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold text-text-strong">
                    Public profile
                  </p>
                  <p className="mt-0.5 text-xs text-text-soft">
                    {agent.publishing.moderation?.status === "approved"
                      ? "Visible in the public profile and marketplace."
                      : `Waiting for ${agent.publishing.moderation?.status?.replace("_", " ") ?? "review"}.`}
                  </p>
                </div>
                <Link
                  href={
                    agent.publishing.moderation?.status === "approved"
                      ? `/agents/${walletEncoded}/${encodeURIComponent(agent.publishing.slug)}`
                      : `/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}#publishing`
                  }
                  className="inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong transition-colors hover:border-accent/60 hover:text-accent"
                >
                  {agent.publishing.moderation?.status === "approved" ? "Open profile" : "Review"}
                  <ArrowRight className="h-3 w-3" aria-hidden="true" />
                </Link>
              </div>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {agent.status === "active" ? (
              <ActionButton
                label="Pause"
                Icon={Clock}
                disabled={pending}
                onClick={() => onStatusChange(agent.id, "paused")}
              />
            ) : agent.status === "paused" ? (
              <ActionButton
                label="Resume"
                Icon={Check}
                disabled={pending}
                onClick={() => onStatusChange(agent.id, "active")}
              />
            ) : (
              <ActionButton
                label="Reactivate"
                Icon={RefreshCw}
                disabled={pending}
                onClick={() => onStatusChange(agent.id, "active")}
              />
            )}
            {agent.status !== "revoked" ? (
              <ActionButton
                label="Revoke"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => onStatusChange(agent.id, "revoked")}
              />
            ) : null}
            <Link
              href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}`}
              className={clsx(
                "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              )}
            >
              Details
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </Link>
            <Link
              href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}#publishing`}
              className={clsx(
                "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
              )}
            >
              <Send className="h-3 w-3" aria-hidden="true" />
              {published ? "Profile" : "Publish"}
            </Link>
            {agent.kind === "mock" ? (
              <Link
                href={`/app/wallet/${walletEncoded}/agents/start?agent=${encodeURIComponent(agent.id)}`}
                className={clsx(
                  "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                )}
              >
                <Play className="h-3 w-3" aria-hidden="true" />
                Start practice
              </Link>
            ) : (
              <Link
                href={`/app/wallet/${walletEncoded}/agents/${encodeURIComponent(agent.id)}/connection`}
                className={clsx(
                  "inline-flex min-h-8 items-center justify-center gap-1 rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                )}
              >
                <Plug className="h-3 w-3" aria-hidden="true" />
                Connect trader
              </Link>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}
export function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 truncate font-medium text-text-strong">{value}</p>
    </div>
  );
}
export function ProposalCard({
  proposal,
  execution,
  venueRequest,
  accountSnapshot,
  pending,
  onApprove,
  onReject,
  onExecute,
  onSubmitVenue,
  onRecheck,
}: {
  proposal: AgentTradeProposal;
  execution: AgentExecutionRecord | null;
  venueRequest: AgentVenueRequestRecord | null;
  accountSnapshot: HyperliquidTestnetAccountSnapshot | null;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
  onSubmitVenue: (id: string) => void;
  onRecheck: (id: string) => void;
}) {
  const lifecycle = buildAgentTradeLifecycle({
    proposal,
    execution,
    venueRequest,
    accountSnapshot,
  });

  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {proposal.market} · {proposal.side}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                lifecycleToneClass(lifecycle.tone),
              )}
            >
              {lifecycle.label}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {tradingPlaceLabel(proposal.venue)} · ${proposal.notionalUsd} ·{" "}
            {proposal.leverage}x
          </p>
          <TradeLifecycleStrip lifecycle={lifecycle} />
          <AgentClearSignProof proposal={proposal} />
          {proposal.policyViolations && proposal.policyViolations.length > 0 ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-rose-300">
              {proposal.policyViolations[0]?.message}
            </p>
          ) : null}
          {proposal.decisionJournal ? (
            <DecisionJournalSummary proposal={proposal} />
          ) : proposal.thesis ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">
              {proposal.thesis}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[11px] font-medium text-text-soft">
            Confidence {proposal.confidence}%
          </span>
          <ProposalActions
            proposal={proposal}
            pending={pending}
            onApprove={onApprove}
            onReject={onReject}
            onExecute={onExecute}
            onSubmitVenue={onSubmitVenue}
            onRecheck={onRecheck}
          />
        </div>
      </div>
    </li>
  );
}
