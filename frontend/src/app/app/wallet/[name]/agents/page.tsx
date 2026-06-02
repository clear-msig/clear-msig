"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import clsx from "clsx";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  BrainCircuit,
  Check,
  Clock,
  Lock,
  Plus,
  Play,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
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
  getAgentVaultPolicy,
  listAgentEvents,
  listAgentExecutions,
  listAgentProposals,
  listAgentScorecards,
  listAgentSessions,
  listAgents,
  rejectAgentProposal,
  recheckAgentProposal,
  renewAgentSession,
  subscribeAgents,
  updateAgentSessionStatus,
  updateAgentStatus,
  type AgentAuditEvent,
  type AgentExecutionRecord,
  type AgentLeaderboardEntry,
  type AgentProfile,
  type AgentScorecard,
  type AgentSessionGrant,
  type AgentTradeProposal,
  type AgentVaultPolicy,
  type AgentKind,
  type AgentProposalStatus,
  type TradingVenue,
} from "@/lib/agents";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function AgentsPage() {
  const params = useParams<{ name: string }>();
  const reduce = useReducedMotion();
  const toast = useToast();
  const [pendingAction, startAction] = useTransition();
  const name = useMemo(() => {
    const raw = params?.name ?? "";
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }, [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const encrypt = encryptStatus();

  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [policy, setPolicy] = useState<AgentVaultPolicy | null>(null);
  const [leaderboard, setLeaderboard] = useState<AgentLeaderboardEntry[]>([]);
  const [proposals, setProposals] = useState<AgentTradeProposal[]>([]);
  const [sessions, setSessions] = useState<AgentSessionGrant[]>([]);
  const [executions, setExecutions] = useState<AgentExecutionRecord[]>([]);
  const [events, setEvents] = useState<AgentAuditEvent[]>([]);
  const [scorecards, setScorecards] = useState<AgentScorecard[]>([]);
  const [proposalCount, setProposalCount] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setAgents(listAgents(name));
      setPolicy(getAgentVaultPolicy(name));
      setLeaderboard(agentLeaderboard(name));
      const nextProposals = listAgentProposals(name);
      const nextSessions = listAgentSessions(name);
      setProposals(nextProposals);
      setSessions(nextSessions);
      setExecutions(listAgentExecutions(name));
      setEvents(listAgentEvents(name));
      setScorecards(listAgentScorecards(name));
      setProposalCount(nextProposals.length);
    };
    refresh();
    return subscribeAgents(refresh);
  }, [name]);

  const motionProps = reduce
    ? {}
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };
  const activeAgents = agents.filter((agent) => agent.status === "active").length;
  const activeSessions = sessions.filter(
    (session) => session.status === "active" && session.expiresAt > Date.now(),
  ).length;
  const openExecutions = executions.filter((execution) => execution.status === "open").length;

  const approveProposal = (id: string) => {
    startAction(() => {
      const updated = approveAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade signal not found");
        return;
      }
      toast.success("Trade signal approved");
    });
  };

  const rejectProposal = (id: string) => {
    startAction(() => {
      const updated = rejectAgentProposal(name, id);
      if (!updated) {
        toast.error("Trade signal not found");
        return;
      }
      toast.success("Trade signal rejected");
    });
  };

  const executeProposal = (id: string) => {
    startAction(() => {
      const execution = executeMockAgentProposal(name, id);
      if (!execution) {
        toast.error("Approve the trade signal first, then check risk limits");
        return;
      }
      toast.success("Paper trade opened");
    });
  };

  const recheckProposal = (id: string) => {
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

  const closeExecution = (id: string, pnlUsd: string) => {
    startAction(() => {
      const updated = closeMockAgentExecution(name, id, pnlUsd);
      if (!updated) {
        toast.error("Paper trade not found");
        return;
      }
      toast.success("Paper trade closed");
    });
  };

  const setAgentStatus = (id: string, status: AgentProfile["status"]) => {
    startAction(() => {
      const updated = updateAgentStatus(name, id, status);
      if (!updated) {
        toast.error("Trading agent not found");
        return;
      }
      toast.success(
        status === "active"
          ? "Trading agent resumed"
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

  return (
    <motion.div
      {...motionProps}
      transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex flex-col gap-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
            Agent Trading · {display}
          </p>
          <h1 className="hidden md:block font-display text-display-xs leading-tight text-text-strong">
            Agent Trading
          </h1>
          <p className="max-w-2xl text-xs leading-relaxed text-text-soft sm:text-sm">
            Register trading agents, review trade signals, set risk limits, and
            test paper trades before connecting real venues.
          </p>
        </div>
        <Link
          href="/privacy"
          className={clsx(
            "inline-flex items-center gap-1.5 rounded-full border border-border-soft px-2.5 py-1 text-[11px] font-medium text-text-soft",
            "transition-colors duration-base ease-out-soft hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Lock className="h-3 w-3" aria-hidden="true" strokeWidth={2} />
          {encrypt.live ? "Privacy on" : "Privacy ready"}
        </Link>
      </header>

      <div className="grid gap-2 sm:grid-cols-5">
        <MetricCard label="Active agents" value={String(activeAgents)} Icon={Bot} />
        <MetricCard label="Trade signals" value={String(proposalCount)} Icon={BrainCircuit} />
        <MetricCard
          label="Risk limits"
          value={policy?.enabled ? "Armed" : "Paused"}
          Icon={ShieldCheck}
        />
        <MetricCard
          label="Active sessions"
          value={String(activeSessions)}
          Icon={Clock}
        />
        <MetricCard
          label="Open paper trades"
          value={String(openExecutions)}
          Icon={Play}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/app/wallet/${encoded}/agents/new`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest sm:flex-none",
            "transition-[background-color,box-shadow,transform] duration-base ease-out-soft",
            "hover:bg-accent-hover hover:shadow-accent-hover active:scale-[0.98]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Plus size={13} aria-hidden="true" />
          Register agent
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/proposals/new`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Send size={13} aria-hidden="true" />
          New signal
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/sessions/new`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <Clock size={13} aria-hidden="true" />
          Start session
        </Link>
        <Link
          href={`/app/wallet/${encoded}/agents/policy`}
          className={clsx(
            "inline-flex flex-1 items-center justify-center gap-1.5 rounded-soft border border-border-soft bg-surface-raised px-3 py-2 text-xs font-medium text-text-strong shadow-card-rest sm:flex-none",
            "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas",
          )}
        >
          <SlidersHorizontal size={13} aria-hidden="true" />
          Risk limits
        </Link>
      </div>

      {agents.length === 0 ? (
        <EmptyAgents href={`/app/wallet/${encoded}/agents/new`} />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Trading agents
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                walletEncoded={encoded}
                rank={leaderboard.findIndex((entry) => entry.agentId === agent.id) + 1}
                leaderboard={leaderboard.find((entry) => entry.agentId === agent.id)}
                scorecard={scorecards.find((entry) => entry.agentId === agent.id)}
                pending={pendingAction}
                onStatusChange={setAgentStatus}
              />
            ))}
          </ul>
        </section>
      )}

      {proposals.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Recent signals
          </h2>
          <ul className="grid gap-3">
            {proposals.slice(0, 5).map((proposal) => (
              <ProposalCard
                key={proposal.id}
                proposal={proposal}
                pending={pendingAction}
                onApprove={approveProposal}
                onReject={rejectProposal}
                onExecute={executeProposal}
                onRecheck={recheckProposal}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {sessions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Trading sessions
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {sessions.slice(0, 4).map((session) => (
              <SessionCard
                key={session.id}
                session={session}
                agent={agents.find((item) => item.id === session.agentId)}
                pending={pendingAction}
                onRevoke={revokeSession}
                onRenew={renewSession}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {executions.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Paper trades
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {executions.slice(0, 4).map((execution) => (
              <ExecutionCard
                key={execution.id}
                execution={execution}
                pending={pendingAction}
                onClose={closeExecution}
              />
            ))}
          </ul>
        </section>
      ) : null}

      {events.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.24em] text-text-soft">
            Agent log
          </h2>
          <ul className="grid gap-2">
            {events.slice(0, 6).map((event) => (
              <AuditEventRow key={event.id} event={event} />
            ))}
          </ul>
        </section>
      ) : null}
    </motion.div>
  );
}

function MetricCard({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: typeof Bot;
}) {
  return (
    <div className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <Icon className="h-4 w-4" aria-hidden="true" strokeWidth={1.75} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-medium text-text-soft">{label}</p>
          <p className="mt-0.5 truncate text-sm font-semibold text-text-strong">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyAgents({ href }: { href: string }) {
  return (
    <div className="rounded-card border border-dashed border-border-soft bg-surface-raised p-8 text-center shadow-card-rest">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
        <Bot className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </div>
      <p className="mt-4 font-display text-base font-semibold text-text-strong">
        No trading agents yet
      </p>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-text-soft">
        Register an agent that can submit trade signals. Agents cannot move
        funds unless a session and risk limits allow it.
      </p>
      <Link
        href={href}
        className="mt-4 inline-flex items-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
      >
        <Plus size={13} aria-hidden="true" />
        Register agent
      </Link>
    </div>
  );
}

function AgentCard({
  agent,
  walletEncoded,
  rank,
  leaderboard,
  scorecard,
  pending,
  onStatusChange,
}: {
  agent: AgentProfile;
  walletEncoded: string;
  rank: number;
  leaderboard?: AgentLeaderboardEntry;
  scorecard?: AgentScorecard;
  pending: boolean;
  onStatusChange: (id: string, status: AgentProfile["status"]) => void;
}) {
  const statusTone =
    agent.status === "active"
      ? "border-accent/30 bg-accent/[0.08] text-accent"
      : agent.status === "paused"
        ? "border-warning/30 bg-warning/[0.08] text-warning"
        : "border-rose-500/30 bg-rose-500/[0.08] text-rose-500";

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
          </div>
          <p className="mt-1 text-xs capitalize text-text-soft">
              {agentKindLabel(agent.kind)}
          </p>
          {agent.description ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-text-soft">
              {agent.description}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft">
              <Trophy className="h-3 w-3" aria-hidden="true" />
              {rank > 0 ? `Rank #${rank}` : "Unranked"}
            </span>
            <span className="inline-flex items-center rounded-full border border-border-soft bg-canvas px-2 py-0.5 text-[11px] font-medium text-text-soft">
              Trust score {leaderboard?.score ?? 50}
            </span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <ScoreStat label="PnL" value={formatSignedUsd(scorecard?.realizedPnlUsd ?? "0")} />
            <ScoreStat label="Executed" value={String(scorecard?.executed ?? 0)} />
            <ScoreStat label="Violations" value={String(scorecard?.ruleViolations ?? 0)} />
            <ScoreStat
              label="Drawdown"
              value={`${formatNumber(scorecard?.maxDrawdownPct ?? 0)}%`}
            />
          </div>
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
          </div>
        </div>
      </div>
    </li>
  );
}

function ScoreStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">
        {label}
      </p>
      <p className="mt-0.5 truncate font-medium text-text-strong">{value}</p>
    </div>
  );
}

function ProposalCard({
  proposal,
  pending,
  onApprove,
  onReject,
  onExecute,
  onRecheck,
}: {
  proposal: AgentTradeProposal;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
  onRecheck: (id: string) => void;
}) {
  const statusTone =
    proposal.status === "blocked"
      ? "border-rose-500/30 bg-rose-500/[0.08] text-rose-500"
      : proposal.status === "approved" || proposal.status === "executed"
        ? "border-accent/30 bg-accent/[0.08] text-accent"
        : "border-warning/30 bg-warning/[0.08] text-warning";

  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-text-strong">
              {proposal.market} · {proposal.side}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium capitalize",
                statusTone,
              )}
            >
              {proposalStatusLabel(proposal.status)}
            </span>
          </div>
          <p className="mt-1 text-xs text-text-soft">
            {tradingPlaceLabel(proposal.venue)} · ${proposal.notionalUsd} ·{" "}
            {proposal.leverage}x
          </p>
          {proposal.policyViolations && proposal.policyViolations.length > 0 ? (
            <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-rose-300">
              {proposal.policyViolations[0]?.message}
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
            onRecheck={onRecheck}
          />
        </div>
      </div>
    </li>
  );
}

function ProposalActions({
  proposal,
  pending,
  onApprove,
  onReject,
  onExecute,
  onRecheck,
}: {
  proposal: AgentTradeProposal;
  pending: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onExecute: (id: string) => void;
  onRecheck: (id: string) => void;
}) {
  if (proposal.status === "rejected") {
    return null;
  }
  if (proposal.status === "blocked") {
    return (
      <ActionButton
        label="Recheck risk"
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

function ExecutionCard({
  execution,
  pending,
  onClose,
}: {
  execution: AgentExecutionRecord;
  pending: boolean;
  onClose: (id: string, pnlUsd: string) => void;
}) {
  const [pnlUsd, setPnlUsd] = useState("");
  const isOpen = execution.status === "open";
  const pnl = Number(execution.realizedPnlUsd || 0);
  return (
    <li className="rounded-card border border-border-soft bg-surface-raised p-4 shadow-card-rest">
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
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-soft">
            <span>Opened {new Date(execution.openedAt).toLocaleString()}</span>
            {!isOpen ? (
              <span
                className={clsx(
                  "font-medium",
                  pnl > 0 ? "text-accent" : pnl < 0 ? "text-rose-300" : "text-text-soft",
                )}
              >
                PnL {formatSignedUsd(execution.realizedPnlUsd)}
              </span>
            ) : null}
          </div>
          {isOpen ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`pnl-${execution.id}`}>
                PnL USD
              </label>
              <input
                id={`pnl-${execution.id}`}
                value={pnlUsd}
                onChange={(event) => setPnlUsd(event.target.value)}
                inputMode="decimal"
                placeholder="PnL USD"
                className={clsx(
                  "min-h-8 w-28 rounded-soft border border-border-soft bg-canvas px-2 py-1 text-xs text-text-strong",
                  "placeholder:text-text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25",
                )}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => onClose(execution.id, pnlUsd)}
                className={clsx(
                  "inline-flex min-h-8 items-center justify-center rounded-soft border border-border-soft px-2 py-1 text-[11px] font-medium text-text-strong",
                  "transition-colors duration-base ease-out-soft hover:border-accent/60 hover:text-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-raised",
                  "disabled:cursor-not-allowed disabled:opacity-60",
                )}
              >
                Close position
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function AuditEventRow({ event }: { event: AgentAuditEvent }) {
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

function tradingPlaceLabel(venue: TradingVenue): string {
  switch (venue) {
    case "mock_perps":
      return "Paper Perps";
    case "hyperliquid_testnet":
      return "Hyperliquid Testnet";
    case "bulktrade_mock":
      return "Bulk Paper";
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

function SessionCard({
  session,
  agent,
  pending,
  onRevoke,
  onRenew,
}: {
  session: AgentSessionGrant;
  agent?: AgentProfile;
  pending: boolean;
  onRevoke: (id: string) => void;
  onRenew: (id: string) => void;
}) {
  const active = session.status === "active" && session.expiresAt > Date.now();
  const displayStatus = active
    ? "Active"
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
              {agent?.name ?? "Unknown agent"}
            </p>
            <span
              className={clsx(
                "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                active
                  ? "border-accent/30 bg-accent/[0.08] text-accent"
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
            Expires {new Date(session.expiresAt).toLocaleString()}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
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
    </li>
  );
}
