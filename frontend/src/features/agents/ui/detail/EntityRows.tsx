"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "next/link";
import { Check, Plug, Play, RefreshCw, Send, X } from "lucide-react";
import { agentSessionPolicyBindingStatus, canOpenLocalAgentExecution, estimateAgentOpenTradePerformance, executionUnavailableReason, type AgentExecutionRecord, type AgentMarketDataSnapshot, type AgentSessionGrant, type AgentTradeProposal, type AgentVaultPolicy } from "@/features/agents/domain";
import { capitalize, formatSignedUsd, formatUsd, proposalStatusLabel, venueLabel } from "@/features/agents/ui/detail/presentation";
import { ScoreRow } from "@/features/agents/ui/detail/PerformancePanels";

export function EntitySection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
        {title}
      </h2>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}
export function SessionRow({
  session,
  policy,
  pending,
  onRevoke,
  onRenew,
}: {
  session: AgentSessionGrant;
  policy: AgentVaultPolicy | null;
  pending: boolean;
  onRevoke: (id: string) => void;
  onRenew: (id: string) => void;
}) {
  const timeActive = session.status === "active" && session.expiresAt > Date.now();
  const bindingStatus = policy
    ? agentSessionPolicyBindingStatus(session, policy)
    : "missing";
  const onchainReady = session.onchain?.status === "executed";
  const active = timeActive && bindingStatus === "current" && onchainReady;
  const stale = timeActive && bindingStatus !== "current";
  const status = active
    ? "Active"
    : stale
      ? "Needs renewal"
      : session.onchain && !onchainReady
        ? "Waiting for approvals"
        : session.status === "active" && session.expiresAt <= Date.now()
        ? "Expired"
        : capitalize(session.status);
  return (
    <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">{status} session</p>
            <Badge tone={active ? "success" : stale ? "warning" : "default"}>
              {status}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {session.allowedMarkets?.join(", ") || "Allowed markets"} · ${session.maxNotionalUsd ?? "limit"} ·{" "}
            {session.maxLeverage ?? "limit"}x
          </p>
          <p className="mt-2 text-[11px] text-text-soft">
            {stale
              ? "Risk limits changed after this session was issued."
              : `Expires ${new Date(session.expiresAt).toLocaleString()}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active ? (
            <ActionButton
              label="Revoke session"
              Icon={X}
              disabled={pending}
              tone="danger"
              onClick={() => onRevoke(session.id)}
            />
          ) : (
            <ActionButton
              label="Renew session"
              Icon={RefreshCw}
              disabled={pending}
              onClick={() => onRenew(session.id)}
            />
          )}
        </div>
      </div>
    </div>
  );
}
export function ProposalRow({
  proposal,
  pending,
  onApprove,
  onReject,
  onRecheck,
  onExecute,
  onSubmitVenue,
}: {
  proposal: AgentTradeProposal;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRecheck: (id: string) => void;
  onExecute: (id: string) => void;
  onSubmitVenue: (id: string) => void;
}) {
  return (
    <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {proposal.market} · {proposal.side}
            </p>
            <Badge tone={proposal.status === "blocked" ? "danger" : proposal.status === "executed" ? "success" : "default"}>
              {proposalStatusLabel(proposal.status)}
            </Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {venueLabel(proposal.venue)} · ${proposal.notionalUsd} · {proposal.leverage}x · Confidence{" "}
            {proposal.confidence}%
          </p>
          {proposal.policyViolations?.[0] ? (
            <p className="mt-2 text-xs leading-relaxed text-rose-300">
              {proposal.policyViolations[0].message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {proposal.status === "blocked" ? (
            <ActionButton
              label="Recheck risk"
              Icon={RefreshCw}
              disabled={pending}
              onClick={() => onRecheck(proposal.id)}
            />
          ) : null}
          {proposal.status === "needs_approval" ? (
            <>
              <ActionButton
                label="Approve"
                Icon={Check}
                disabled={pending}
                onClick={() => onApprove(proposal.id)}
              />
              <ActionButton
                label="Reject"
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
                label="Open paper trade"
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
      </div>
    </div>
  );
}
export function ExecutionRow({
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
  const open = execution.status === "open";
  const pnl = Number(execution.realizedPnlUsd || 0);
  const performance = estimateAgentOpenTradePerformance(execution, marketSnapshot);
  return (
    <div className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {execution.market} · {execution.side}
            </p>
            <Badge tone={open ? "success" : "default"}>{open ? "Open" : "Closed"}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {venueLabel(execution.venue)} · ${execution.notionalUsd} · {execution.leverage}x
          </p>
          {open ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <ScoreRow label="Entry" value={formatUsd(execution.entryPrice ?? "0")} />
              <ScoreRow
                label="Mark"
                value={performance ? formatUsd(performance.markPriceUsd) : "Waiting"}
              />
              <ScoreRow
                label="Est. P/L"
                value={performance ? formatSignedUsd(performance.unrealizedPnlUsd) : "Unknown"}
              />
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-text-soft">
            <span>Opened {new Date(execution.openedAt).toLocaleString()}</span>
            {!open ? (
              <span className={clsx("font-medium", pnl > 0 ? "text-accent" : pnl < 0 ? "text-rose-300" : "text-text-soft")}>
                PnL {formatSignedUsd(execution.realizedPnlUsd)}
              </span>
            ) : null}
          </div>
        </div>
        {open ? (
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label="Profit or loss in USD"
              value={pnlUsd}
              onChange={(event) => setPnlUsd(event.target.value)}
              inputMode="decimal"
              placeholder="PnL USD"
              className="min-h-8 w-28 rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs text-text-strong placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25"
            />
            <ActionButton
              label="Close position"
              Icon={X}
              disabled={pending}
              onClick={() => onClose(execution.id, pnlUsd || performance?.unrealizedPnlUsd || "0")}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
export function LinkButton({
  href,
  Icon,
  children,
}: {
  href: string;
  Icon: typeof Send;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest transition-colors hover:border-accent/60 hover:text-accent"
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </Link>
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
        "transition-colors duration-base ease-out-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised disabled:cursor-not-allowed disabled:opacity-60",
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
export function Badge({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
        tone === "success"
          ? "border-accent/30 bg-accent/[0.08] text-accent"
          : tone === "warning"
            ? "border-warning/30 bg-warning/[0.08] text-warning"
            : tone === "danger"
              ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-500"
              : "border-border-soft bg-canvas text-text-soft",
      )}
    >
      {children}
    </span>
  );
}
export function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-card bg-surface-raised p-4 text-sm text-text-soft">
      {text}
    </div>
  );
}
