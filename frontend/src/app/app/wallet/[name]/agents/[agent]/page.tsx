"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import type { ReactNode } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  Check,
  Clock,
  Lock,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  Trophy,
  X,
} from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { encryptStatus } from "@/lib/encrypt/client";
import {
  agentLeaderboard,
  approveAgentProposal,
  closeMockAgentExecution,
  executeMockAgentProposal,
  findAgent,
  getAgentVaultPolicy,
  agentRiskSnapshot,
  listAgentEvents,
  listAgentExecutions,
  listAgentProposals,
  listAgentScorecards,
  listAgentSessions,
  rejectAgentProposal,
  recheckAgentProposal,
  renewAgentSession,
  subscribeAgents,
  updateAgentSessionStatus,
  updateAgentStatus,
  type AgentAuditEvent,
  type AgentExecutionRecord,
  type AgentKind,
  type AgentLeaderboardEntry,
  type AgentRiskSnapshot,
  type AgentProfile,
  type AgentProposalStatus,
  type AgentScorecard,
  type AgentSessionGrant,
  type AgentTradeProposal,
  type AgentTradingMode,
  type TradingVenue,
} from "@/lib/agents";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function AgentDetailPage() {
  const params = useParams<{ name: string; agent: string }>();
  const toast = useToast();
  const encrypt = encryptStatus();
  const [pending, startAction] = useTransition();

  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const agentId = useMemo(() => decodeParam(params?.agent), [params?.agent]);
  const encodedWallet = encodeURIComponent(name);
  const display = toDisplayName(name);

  const [agent, setAgent] = useState<AgentProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<AgentLeaderboardEntry | undefined>();
  const [scorecard, setScorecard] = useState<AgentScorecard | undefined>();
  const [risk, setRisk] = useState<AgentRiskSnapshot | null>(null);
  const [dailyLossCapUsd, setDailyLossCapUsd] = useState("100");
  const [proposals, setProposals] = useState<AgentTradeProposal[]>([]);
  const [sessions, setSessions] = useState<AgentSessionGrant[]>([]);
  const [executions, setExecutions] = useState<AgentExecutionRecord[]>([]);
  const [events, setEvents] = useState<AgentAuditEvent[]>([]);

  useEffect(() => {
    const refresh = () => {
      setAgent(findAgent(name, agentId));
      setLeaderboard(agentLeaderboard(name).find((entry) => entry.agentId === agentId));
      setScorecard(listAgentScorecards(name).find((entry) => entry.agentId === agentId));
      setRisk(agentRiskSnapshot(name, agentId));
      setDailyLossCapUsd(getAgentVaultPolicy(name).dailyLossCapUsd || "100");
      setProposals(listAgentProposals(name).filter((item) => item.agentId === agentId));
      setSessions(listAgentSessions(name).filter((item) => item.agentId === agentId));
      setExecutions(listAgentExecutions(name).filter((item) => item.agentId === agentId));
      setEvents(listAgentEvents(name).filter((item) => item.agentId === agentId));
    };
    refresh();
    return subscribeAgents(refresh);
  }, [agentId, name]);

  const activeSessions = sessions.filter(
    (session) => session.status === "active" && session.expiresAt > Date.now(),
  ).length;
  const openPositions = executions.filter((execution) => execution.status === "open").length;
  const blockedSignals = proposals.filter((proposal) => proposal.status === "blocked").length;

  const setStatus = (status: AgentProfile["status"]) => {
    startAction(() => {
      const updated = updateAgentStatus(name, agentId, status);
      if (!updated) {
        toast.error("Trading agent not found");
        return;
      }
      toast.success(
        status === "active"
          ? "Trading agent active"
          : status === "paused"
            ? "Trading agent paused"
            : "Trading agent revoked",
      );
    });
  };

  const revokeSession = (id: string) => {
    startAction(() => {
      const updated = updateAgentSessionStatus(name, id, "revoked");
      if (!updated) {
        toast.error("Trading session not found");
        return;
      }
      toast.success("Trading session revoked");
    });
  };

  const renewSession = (id: string) => {
    startAction(() => {
      const renewed = renewAgentSession(name, id);
      if (!renewed) {
        toast.error("Reactivate the agent before renewing this session");
        return;
      }
      toast.success("Trading session renewed");
    });
  };

  const approveSignal = (id: string) => {
    startAction(() => {
      const updated = approveAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade signal not found");
        return;
      }
      toast.success("Trade signal approved");
    });
  };

  const rejectSignal = (id: string) => {
    startAction(() => {
      const updated = rejectAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade signal not found");
        return;
      }
      toast.success("Trade signal rejected");
    });
  };

  const recheckSignal = (id: string) => {
    startAction(() => {
      const result = recheckAgentProposal(name, id);
      if (!result) {
        toast.error("Trade signal not found");
        return;
      }
      if (result.execution) {
        toast.success("Trade signal passed risk and paper trade opened");
      } else if (result.proposal.status === "blocked") {
        toast.error("Trade signal is still blocked by risk limits");
      } else if (result.proposal.status === "approved") {
        toast.success("Trade signal is approved by active session");
      } else {
        toast.success("Trade signal now needs approval");
      }
    });
  };

  const openPaperTrade = (id: string) => {
    startAction(() => {
      const execution = executeMockAgentProposal(name, id);
      if (!execution) {
        toast.error("Approve the trade signal first, then check risk limits");
        return;
      }
      toast.success("Paper trade opened");
    });
  };

  const closePaperTrade = (id: string, pnlUsd: string) => {
    startAction(() => {
      const updated = closeMockAgentExecution(name, id, pnlUsd);
      if (!updated) {
        toast.error("Paper trade not found");
        return;
      }
      toast.success("Paper trade closed");
    });
  };

  if (!agent) {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        <Link
          href={`/app/wallet/${encodedWallet}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="rounded-card border border-border-soft bg-surface-raised p-6 shadow-card-rest">
          <p className="text-sm font-semibold text-text-strong">Trading agent not found</p>
          <p className="mt-1 text-sm text-text-soft">
            This agent may have been removed from local storage.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            href={`/app/wallet/${encodedWallet}/agents`}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Agent Trading
          </Link>
          <Link
            href="/privacy"
            className="inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft transition-colors hover:text-accent"
          >
            <Lock className="h-3 w-3" aria-hidden="true" />
            {encrypt.live ? "Privacy on" : "Privacy ready"}
          </Link>
        </div>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Agent Trading · {display}
            </p>
            <h1 className="hidden md:block mt-1 truncate font-display text-display-xs leading-tight text-text-strong">
              {agent.name}
            </h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Badge tone={agent.status === "active" ? "success" : agent.status === "paused" ? "warning" : "danger"}>
                {agent.status}
              </Badge>
              <Badge>{agentKindLabel(agent.kind)}</Badge>
              <Badge>Trust score {leaderboard?.score ?? 50}</Badge>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href={`/app/wallet/${encodedWallet}/agents/proposals/new`} Icon={Send}>
              New signal
            </LinkButton>
            <LinkButton href={`/app/wallet/${encodedWallet}/agents/sessions/new`} Icon={Clock}>
              Start session
            </LinkButton>
            <LinkButton href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agent.id)}/strategy`} Icon={ShieldCheck}>
              Strategy
            </LinkButton>
          </div>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="PnL" value={formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")} />
        <Metric label="Trust score" value={String(leaderboard?.score ?? 50)} />
        <Metric label="Executed" value={String(scorecard?.executed ?? 0)} />
        <Metric label="Open positions" value={String(openPositions)} />
        <Metric label="Blocked signals" value={String(blockedSignals)} />
        <Metric label="Active sessions" value={String(activeSessions)} />
        <Metric label="Today PnL" value={formatSignedUsd(risk?.dailyRealizedPnlUsd ?? "0")} />
      </section>

      <section className="grid gap-3 lg:grid-cols-[1fr_1.2fr]">
        <Panel title="Agent Profile" Icon={Bot}>
          <div className="grid gap-3 text-sm">
            <InfoRow label="Type" value={agentKindLabel(agent.kind)} />
            <InfoRow label="Status" value={agent.status} />
            <InfoRow label="Public key" value={agent.identityPubkey || "Not set"} />
            <InfoRow label="Endpoint" value={agent.endpoint || "Not set"} />
            <InfoRow label="Created" value={new Date(agent.createdAt).toLocaleString()} />
            {agent.description ? (
              <div>
                <p className="text-xs font-medium text-text-soft">Strategy notes</p>
                <p className="mt-1 text-sm leading-relaxed text-text-strong">{agent.description}</p>
              </div>
            ) : null}
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border-soft pt-4">
            {agent.status === "active" ? (
              <ActionButton
                label="Pause"
                Icon={Clock}
                disabled={pending}
                onClick={() => setStatus("paused")}
              />
            ) : agent.status === "paused" ? (
              <ActionButton
                label="Resume"
                Icon={Check}
                disabled={pending}
                onClick={() => setStatus("active")}
              />
            ) : (
              <ActionButton
                label="Reactivate"
                Icon={RefreshCw}
                disabled={pending}
                onClick={() => setStatus("active")}
              />
            )}
            {agent.status !== "revoked" ? (
              <ActionButton
                label="Revoke"
                Icon={X}
                disabled={pending}
                tone="danger"
                onClick={() => setStatus("revoked")}
              />
            ) : null}
          </div>
        </Panel>

        <Panel title="Scorecard" Icon={Trophy}>
          <div className="grid gap-2 sm:grid-cols-2">
            <ScoreRow label="Proposals" value={scorecard?.proposals ?? 0} />
            <ScoreRow label="Approved" value={scorecard?.approved ?? 0} />
            <ScoreRow label="Rejected" value={scorecard?.rejected ?? 0} />
            <ScoreRow label="Blocked" value={scorecard?.blocked ?? 0} />
            <ScoreRow label="Rule violations" value={scorecard?.ruleViolations ?? 0} />
            <ScoreRow label="Drawdown" value={`${formatNumber(scorecard?.maxDrawdownPct ?? 0)}%`} />
            <ScoreRow label="Daily loss cap" value={`$${dailyLossCapUsd}`} />
          </div>
        </Panel>
      </section>

      <Panel title="Strategy Playbook" Icon={ShieldCheck}>
        {agent.strategy ? (
          <div className="grid gap-3 text-sm">
            <div className="flex flex-wrap gap-1.5">
              <Badge>{strategyModeLabel(agent.strategy.mode)}</Badge>
              {agent.strategy.allowedMarkets.map((market) => (
                <Badge key={market}>{market}</Badge>
              ))}
            </div>
            {agent.strategy.summary ? (
              <InfoRow label="Summary" value={agent.strategy.summary} />
            ) : null}
            <InfoRow label="Entry rules" value={agent.strategy.entryRules || "Not set"} />
            <InfoRow label="Exit rules" value={agent.strategy.exitRules || "Not set"} />
            <InfoRow label="Risk rules" value={agent.strategy.riskRules || "Not set"} />
            <InfoRow
              label="Execution protocol"
              value={agent.strategy.executionProtocol || "Not set"}
            />
            <InfoRow
              label="Kill switch"
              value={agent.strategy.killSwitchRules || "Not set"}
            />
          </div>
        ) : (
          <div className="rounded-soft border border-dashed border-border-soft bg-canvas p-4">
            <p className="text-sm font-medium text-text-strong">No strategy playbook yet</p>
            <p className="mt-1 text-sm text-text-soft">
              Add entry rules, exit rules, risk rules, and execution protocol before moving toward live venues.
            </p>
          </div>
        )}
        <div className="mt-4 border-t border-border-soft pt-4">
          <LinkButton href={`/app/wallet/${encodedWallet}/agents/${encodeURIComponent(agent.id)}/strategy`} Icon={ShieldCheck}>
            Edit strategy
          </LinkButton>
        </div>
      </Panel>

      <EntitySection title="Trading Sessions">
        {sessions.length > 0 ? (
          sessions.slice(0, 6).map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              pending={pending}
              onRevoke={revokeSession}
              onRenew={renewSession}
            />
          ))
        ) : (
          <EmptyLine text="No trading sessions yet." />
        )}
      </EntitySection>

      <EntitySection title="Trade Signals">
        {proposals.length > 0 ? (
          proposals.slice(0, 8).map((proposal) => (
            <ProposalRow
              key={proposal.id}
              proposal={proposal}
              pending={pending}
              onApprove={approveSignal}
              onReject={rejectSignal}
              onRecheck={recheckSignal}
              onExecute={openPaperTrade}
            />
          ))
        ) : (
          <EmptyLine text="No trade signals yet." />
        )}
      </EntitySection>

      <EntitySection title="Paper Trades">
        {executions.length > 0 ? (
          executions.slice(0, 8).map((execution) => (
            <ExecutionRow
              key={execution.id}
              execution={execution}
              pending={pending}
              onClose={closePaperTrade}
            />
          ))
        ) : (
          <EmptyLine text="No paper trades yet." />
        )}
      </EntitySection>

      <EntitySection title="Agent Log">
        {events.length > 0 ? (
          events.slice(0, 10).map((event) => (
            <div
              key={event.id}
              className="rounded-soft border border-border-soft bg-surface-raised px-3 py-2 shadow-card-rest"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-strong">{event.message}</p>
                <span className="text-[11px] text-text-soft">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))
        ) : (
          <EmptyLine text="No agent activity yet." />
        )}
      </EntitySection>
    </div>
  );
}

function Panel({
  title,
  Icon,
  children,
}: {
  title: string;
  Icon: typeof Bot;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
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

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-3 shadow-card-rest">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-text-soft">
        {label}
      </p>
      <p className="mt-1 truncate text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-soft">{label}</p>
      <p className="mt-1 break-words text-sm text-text-strong">{value}</p>
    </div>
  );
}

function ScoreRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <p className="text-xs font-medium text-text-soft">{label}</p>
      <p className="mt-1 text-sm font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function EntitySection({
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

function SessionRow({
  session,
  pending,
  onRevoke,
  onRenew,
}: {
  session: AgentSessionGrant;
  pending: boolean;
  onRevoke: (id: string) => void;
  onRenew: (id: string) => void;
}) {
  const active = session.status === "active" && session.expiresAt > Date.now();
  const status = active
    ? "Active"
    : session.status === "active" && session.expiresAt <= Date.now()
      ? "Expired"
      : capitalize(session.status);
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">{status} session</p>
            <Badge tone={active ? "success" : "default"}>{status}</Badge>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {session.allowedMarkets?.join(", ") || "Allowed markets"} · ${session.maxNotionalUsd ?? "limit"} ·{" "}
            {session.maxLeverage ?? "limit"}x
          </p>
          <p className="mt-2 text-[11px] text-text-soft">
            Expires {new Date(session.expiresAt).toLocaleString()}
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

function ProposalRow({
  proposal,
  pending,
  onApprove,
  onReject,
  onRecheck,
  onExecute,
}: {
  proposal: AgentTradeProposal;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onRecheck: (id: string) => void;
  onExecute: (id: string) => void;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
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
            <ActionButton
              label="Open paper trade"
              Icon={Play}
              disabled={pending}
              onClick={() => onExecute(proposal.id)}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ExecutionRow({
  execution,
  pending,
  onClose,
}: {
  execution: AgentExecutionRecord;
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
}) {
  const [pnlUsd, setPnlUsd] = useState("");
  const open = execution.status === "open";
  const pnl = Number(execution.realizedPnlUsd || 0);
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
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
              onClick={() => onClose(execution.id, pnlUsd)}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LinkButton({
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

function ActionButton({
  label,
  Icon,
  disabled,
  tone = "default",
  onClick,
}: {
  label: string;
  Icon: typeof Check;
  disabled: boolean;
  tone?: "default" | "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
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

function Badge({
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

function EmptyLine({ text }: { text: string }) {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-4 text-sm text-text-soft">
      {text}
    </div>
  );
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function agentKindLabel(kind: AgentKind): string {
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

function proposalStatusLabel(status: AgentProposalStatus): string {
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

function venueLabel(venue: TradingVenue): string {
  switch (venue) {
    case "mock_perps":
      return "Paper Perps";
    case "hyperliquid_testnet":
      return "Hyperliquid Testnet";
    case "bulktrade_mock":
      return "Bulk Paper";
  }
}

function strategyModeLabel(mode: AgentTradingMode): string {
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

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}

function formatNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
    : "0";
}

function capitalize(value: string): string {
  return value.length > 0 ? `${value[0]?.toUpperCase()}${value.slice(1)}` : value;
}
