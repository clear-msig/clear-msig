"use client";

import type { ReactNode } from "react";
import clsx from "clsx";
import { ArrowRight, AlertTriangle, Bot, Check, Clock, Copy, Globe, Play, ShieldCheck, Trophy, X } from "lucide-react";
import { publicProfileUrl, type AgentAllocationRecommendation, type AgentLibraryMetrics, type AgentModerationStatus, type AgentProfile, type AgentSessionGrant, type AgentTradingReadiness } from "@/features/agents/domain";
import { ActionButton, Badge, LinkButton } from "@/features/agents/ui/detail/EntityRows";
import { allocationActionLabel, allocationBadgeTone, decodeParam, formatShortDate, formatSignedUsd, formatUsd, moderationBadgeTone, moderationLabel, plainAllowanceSummary, plainMetricText, readinessActionLabel, readinessBadgeTone, readinessHref } from "@/features/agents/ui/detail/presentation";
import { ScoreRow } from "@/features/agents/ui/detail/PerformancePanels";

export function Panel({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Bot;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="mb-4 flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
      </div>
      {children}
    </section>
  );
}
export function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface-raised p-3 shadow-card-rest">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}
export function ReadinessPanel({
  readiness,
  walletEncoded,
  agentId,
}: {
  readiness: AgentTradingReadiness;
  walletEncoded: string;
  agentId: string;
}) {
  return (
    <section
      id="publishing"
      className="rounded-card bg-surface-raised p-4 shadow-card-rest"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              readiness.status === "ready"
                ? "bg-accent/10 text-accent"
                : readiness.status === "blocked"
                  ? "bg-rose-500/[0.08] text-rose-300"
                  : "bg-warning/[0.08] text-warning",
            )}
          >
            {readiness.status === "ready" ? (
              <Check className="h-4 w-4" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            )}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Ready to trade
              </h2>
              <Badge tone={readinessBadgeTone(readiness.status)}>
                {readiness.score}% · {readiness.headline}
              </Badge>
            </div>
          </div>
        </div>
        <LinkButton
          href={readinessHref(walletEncoded, agentId, readiness.primaryAction)}
          Icon={ArrowRight}
        >
          {readinessActionLabel(readiness.primaryAction)}
        </LinkButton>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {readiness.items.map((item) => (
          <div
            key={item.id}
            className="rounded-soft border border-border-soft bg-canvas px-3 py-2"
          >
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={clsx(
                  "h-2 w-2 rounded-full",
                  item.status === "pass"
                    ? "bg-accent"
                    : item.status === "block"
                      ? "bg-rose-400"
                      : "bg-warning",
                )}
              />
              <p className="text-xs font-semibold text-text-strong">{item.label}</p>
              <Badge tone={item.status === "pass" ? "success" : item.status === "block" ? "danger" : "warning"}>
                {item.status === "pass" ? "Ready" : item.status === "block" ? "Blocked" : "Setup"}
              </Badge>
            </div>
            <details className="group mt-1">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium text-text-soft transition-colors hover:text-accent">
                Why
                <ArrowRight
                  className="h-3 w-3 transition-transform group-open:rotate-90"
                  aria-hidden="true"
                />
              </summary>
              <p className="mt-1.5 text-xs leading-relaxed text-text-soft">
                {item.message}
              </p>
            </details>
          </div>
        ))}
      </div>
    </section>
  );
}
export function AllowanceDecisionPanel({
  recommendation,
  metrics,
  activeSession,
  walletEncoded,
  agentId,
}: {
  recommendation: AgentAllocationRecommendation;
  metrics: AgentLibraryMetrics;
  activeSession?: AgentSessionGrant;
  walletEncoded: string;
  agentId: string;
}) {
  const startHref = activeSession
    ? `/app/wallet/${walletEncoded}/agents/start?agent=${encodeURIComponent(agentId)}`
    : `/app/wallet/${walletEncoded}/agents/sessions/new?agent=${encodeURIComponent(agentId)}`;
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
            <Trophy className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Suggested budget
              </h2>
              <Badge tone={allocationBadgeTone(recommendation.action)}>
                {allocationActionLabel(recommendation.action)}
              </Badge>
            </div>
            <p className="mt-1 text-sm leading-relaxed text-text-soft">
              {plainAllowanceSummary(recommendation)}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <LinkButton href={startHref} Icon={activeSession ? Play : Clock}>
            {activeSession ? "Start practice" : "Set budget"}
          </LinkButton>
          <LinkButton href={`/app/wallet/${walletEncoded}/agents/library`} Icon={Trophy}>
            Explore traders
          </LinkButton>
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ScoreRow label="Budget level" value={recommendation.tier.label} />
        <ScoreRow
          label="Trade size"
          value={formatUsd(recommendation.limits.maxNotionalUsd)}
        />
        <ScoreRow label="Open trades" value={recommendation.limits.maxOpenPositions} />
        <ScoreRow label="Time window" value={`${recommendation.limits.sessionHours}h`} />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div>
          <p className="text-xs font-semibold text-text-strong">Why this budget?</p>
          <ul className="mt-2 grid gap-1.5">
            {recommendation.reasons.slice(0, 5).map((reason) => (
              <li key={reason} className="flex items-start gap-2 text-xs text-text-soft">
                <Check className="mt-0.5 h-3 w-3 shrink-0 text-accent" aria-hidden="true" />
                <span>{plainMetricText(reason)}</span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-semibold text-text-strong">Recent proof</p>
          <div className="mt-2 grid gap-1.5 text-xs text-text-soft">
            <span>7-day profit/loss: {formatSignedUsd(metrics.sevenDayPnlUsd)}</span>
            <span>
              Win rate: {metrics.winRatePct == null ? "not enough trades yet" : `${metrics.winRatePct}%`}
            </span>
            <span>Completed trades: {metrics.closedTrades}</span>
            <span>Open trades now: {metrics.openTrades}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
export function PublishingPanel({
  agent,
  walletEncoded,
  pending,
  onPublish,
  onUnpublish,
  onModerate,
  onCopy,
}: {
  agent: AgentProfile;
  walletEncoded: string;
  pending: boolean;
  onPublish: () => void;
  onUnpublish: () => void;
  onModerate: (status: AgentModerationStatus, reason?: string) => void;
  onCopy: () => void;
}) {
  const published = agent.publishing?.status === "published";
  const moderation = agent.publishing?.moderation;
  const slug = agent.publishing?.slug ?? "not-published";
  const previewHref = publicProfileUrl(
    decodeParam(walletEncoded),
    agent.publishing?.slug ?? agent.id,
  );
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={clsx(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
              published ? "bg-accent/10 text-accent" : "bg-canvas text-text-soft",
            )}
          >
            <Globe className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-text-strong">
                Agent publishing
              </h2>
              <Badge tone={published ? "success" : "default"}>
                {published ? "Published" : "Draft"}
              </Badge>
              {published ? (
                <Badge tone={moderationBadgeTone(moderation?.status)}>
                  {moderationLabel(moderation?.status ?? "pending_review")}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {published ? (
            <>
              <ActionButton
                label="Copy profile"
                Icon={Copy}
                disabled={pending}
                onClick={onCopy}
              />
              <ActionButton
                label="Approve"
                Icon={ShieldCheck}
                disabled={pending}
                onClick={() =>
                  onModerate("approved", "Profile passed marketplace review.")
                }
              />
              <ActionButton
                label="Review"
                Icon={Clock}
                disabled={pending}
                onClick={() =>
                  onModerate(
                    "pending_review",
                    "Profile is waiting for marketplace review.",
                  )
                }
              />
              <ActionButton
                label="Pause listing"
                Icon={AlertTriangle}
                disabled={pending}
                onClick={() =>
                  onModerate(
                    "paused",
                    "Profile is paused while ClearSig reviews recent behavior.",
                  )
                }
              />
              <ActionButton
                label="Delist"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() =>
                  onModerate("delisted", "Profile is hidden from marketplace discovery.")
                }
              />
              <ActionButton
                label="Unpublish"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={onUnpublish}
              />
            </>
          ) : (
            <ActionButton
              label="Publish"
              Icon={Globe}
              disabled={pending}
              onClick={onPublish}
            />
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <ScoreRow label="Profile slug" value={slug} />
        <ScoreRow
          label="Visible metrics"
          value={published ? String(agent.publishing?.visibleMetrics.length ?? 0) : "None"}
        />
        <ScoreRow
          label="Marketplace review"
          value={published ? moderationLabel(moderation?.status ?? "pending_review") : "Not published"}
        />
        <ScoreRow
          label="Preview"
          value={published ? previewHref : "Publish first"}
        />
      </div>
      {published ? (
        <div className="mt-3 rounded-soft border border-border-soft bg-canvas px-3 py-2">
          <p className="text-xs leading-relaxed text-text-soft">
            Published {formatShortDate(agent.publishing?.publishedAt ?? Date.now())}.
            Current testing link: {previewHref}
          </p>
          {moderation?.reason ? (
            <p className="mt-1 text-xs leading-relaxed text-text-soft">
              Review note: {moderation.reason}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
