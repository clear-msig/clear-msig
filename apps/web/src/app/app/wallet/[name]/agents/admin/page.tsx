"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CheckCircle2,
  MessageSquare,
  Plug,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { type AgentExecutionRecord, type AgentMarketReadiness, type AgentProfile, type AgentTradeProposal, buildAgentBetaReadiness, buildAgentMarketReadiness, hasAgentComplianceAcknowledgement } from "@/features/agents/domain/runtime";
import { getAgentVaultPolicy, listAgentConnectionKits, listAgentExecutions, listAgentOwnerApprovals, listAgentProposals, listAgents, listAgentSessions, subscribeAgents } from "@/features/agents/infrastructure/agentStore";
import { type AgentBetaFeedbackItem, listAgentBetaFeedback } from "@/features/agents/infrastructure/feedbackStore";
import { type AgentVenueReadiness, loadAgentVenueReadiness } from "@/features/agents/infrastructure/executionClient";
import { toDisplayName } from "@/lib/retail/walletNames";

export default function AgentAdminPage() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();
  const name = useMemo(() => decodeParam(params?.name), [params?.name]);
  const encoded = encodeURIComponent(name);
  const display = toDisplayName(name);
  const [agents, setAgents] = useState<AgentProfile[]>([]);
  const [proposals, setProposals] = useState<AgentTradeProposal[]>([]);
  const [executions, setExecutions] = useState<AgentExecutionRecord[]>([]);
  const [feedback, setFeedback] = useState<AgentBetaFeedbackItem[]>([]);
  const [venue, setVenue] = useState<AgentVenueReadiness | null>(null);

  useEffect(() => {
    const refresh = () => {
      setAgents(listAgents(name));
      setProposals(listAgentProposals(name));
      setExecutions(listAgentExecutions(name));
      setFeedback(listAgentBetaFeedback(name));
    };
    refresh();
    return subscribeAgents(refresh);
  }, [name]);

  useEffect(() => {
    let cancelled = false;
    const firstAgent = agents[0];
    if (!firstAgent) {
      setVenue(null);
      return;
    }
    void loadAgentVenueReadiness("hyperliquid_testnet", {
      walletName: name,
      agentId: firstAgent.id,
    }).then((next) => {
      if (!cancelled) setVenue(next);
    });
    return () => {
      cancelled = true;
    };
  }, [agents, name]);

  const policy = getAgentVaultPolicy(name);
  const sessions = listAgentSessions(name);
  const approvals = listAgentOwnerApprovals(name);
  const connections = listAgentConnectionKits(name);
  const pendingModeration = agents.filter(
    (agent) =>
      agent.publishing?.status === "published" &&
      agent.publishing.moderation?.status !== "approved",
  );
  const blockedSignals = proposals.filter(
    (proposal) =>
      proposal.status === "blocked" ||
      proposal.status === "expired" ||
      proposal.evaluationDecision === "blocked",
  );
  const riskyAgents = agents.filter((agent) => {
    const agentExecutions = executions.filter((execution) => execution.agentId === agent.id);
    const openTrades = agentExecutions.filter((execution) => execution.status === "open").length;
    const blocked = blockedSignals.filter((proposal) => proposal.agentId === agent.id).length;
    return agent.status !== "active" || openTrades > 0 || blocked > 0;
  });
  const marketReadiness: AgentMarketReadiness = buildAgentMarketReadiness({
    agents,
    policy,
    sessions,
    executions,
    proposals,
    approvals,
    connections,
    backend: {
      state: "synced",
      storage: "memory",
    },
    marketData: {
      openMarkets: new Set(executions.filter((execution) => execution.status === "open").map((execution) => execution.market)).size,
      pricedOpenMarkets: 0,
      liveMarkets: 0,
      hasFundingRates: false,
    },
    venue: {
      state:
        venue?.state === "ready" &&
          venue.executorProbe?.state === "ready" &&
          venue.accountProbe?.state === "funded"
          ? "connected"
          : venue
            ? "needs_setup"
            : "unavailable",
    },
    operations: {
      walletSignedMutations: approvals.some(
        (approval) => approval.approvalMethod === "wallet_signature" && approval.signature,
      )
        ? "partial"
        : "none",
      creatorRegistry: agents.some((agent) => agent.publishing?.status === "published")
        ? "local_profiles"
        : "none",
      creatorPayouts: "not_started",
      externalVerification: connections.length > 0 ? "signed_decisions" : "none",
      marketIntelligence: {
        news: false,
        macro: false,
        rateLimited: true,
      },
      leaderboardMode: "separated",
      compliance: hasAgentComplianceAcknowledgement(name, "mock_perps")
        ? "user_disclosures"
        : "draft",
      moderation: agents.some((agent) => agent.publishing?.status === "published")
        ? "active"
        : "none",
      abuseControls: {
        sameOrigin: true,
        rateLimits: true,
        signalKeys: connections.length > 0,
        replayProtection: proposals.some((proposal) => Boolean(proposal.clientSignalId)),
        signedSignals: connections.length > 0,
      },
      venueReconciliation: venue?.reconciliation ? "testnet_snapshots" : "requested",
    },
    walletHref: `/app/wallet/${encoded}`,
  });
  const betaReadiness = buildAgentBetaReadiness({
    agents,
    policy,
    sessions,
    executions,
    proposals,
    approvals,
    connections,
    backend: {
      state: "synced",
      storage: "memory",
    },
    marketData: {
      openMarkets: new Set(executions.filter((execution) => execution.status === "open").map((execution) => execution.market)).size,
      pricedOpenMarkets: 0,
    },
    venue: {
      state:
        venue?.state === "ready" &&
          venue.executorProbe?.state === "ready" &&
          venue.accountProbe?.state === "funded"
          ? "connected"
          : venue
            ? "needs_setup"
            : "unavailable",
    },
    walletHref: `/app/wallet/${encoded}`,
  });

  if (search.get("debug") !== "1") {
    return (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <section className="rounded-card bg-surface-raised p-6 shadow-card-rest">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-semibold text-text-strong">
                Admin tools are hidden
              </p>
              <p className="mt-1 text-sm leading-relaxed text-text-soft">
                This surface is reserved for internal testing and moderation.
                Use Agent Trading for trader setup, guardrails, allowance, and
                monitoring.
              </p>
              <Link
                href={`/app/wallet/${encoded}/agents`}
                className="mt-4 inline-flex min-h-9 items-center justify-center gap-1.5 rounded-soft bg-accent px-3 py-2 text-xs font-medium text-text-on-accent shadow-accent-rest"
              >
                Return to Agent Trading
              </Link>
            </div>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <header className="flex flex-col gap-3">
        <Link
          href={`/app/wallet/${encoded}/agents`}
          className="inline-flex w-fit items-center gap-1.5 text-xs font-medium text-text-soft transition-colors hover:text-accent"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Agent Trading
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-text-soft">
              Beta Admin · {display}
            </p>
            <h1 className="mt-1 font-display text-lg leading-tight text-text-strong md:text-display-xs">
              Operator dashboard
            </h1>
          </div>
          <Badge tone={betaReadiness.status === "ready" ? "success" : "warning"}>
            {betaReadiness.headline}
          </Badge>
        </div>
      </header>

      <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <Metric label="Agents" value={String(agents.length)} Icon={Bot} />
        <Metric label="Open trades" value={String(executions.filter((execution) => execution.status === "open").length)} Icon={Plug} />
        <Metric label="Blocked ideas" value={String(blockedSignals.length)} Icon={AlertTriangle} />
        <Metric label="Pending review" value={String(pendingModeration.length)} Icon={ShieldCheck} />
        <Metric label="Feedback" value={String(feedback.length)} Icon={MessageSquare} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <AdminPanel title="Launch blockers" count={betaReadiness.checks.filter((item) => item.status !== "pass").length}>
          {betaReadiness.checks
            .filter((item) => item.status !== "pass")
            .slice(0, 6)
            .map((item) => (
              <StatusRow key={item.id} title={item.label} detail={item.message} tone={item.status === "block" ? "danger" : "warning"} />
            ))}
          {betaReadiness.checks.every((item) => item.status === "pass") ? (
            <StatusRow title="No public beta blocker" detail={betaReadiness.summary} tone="success" />
          ) : null}
        </AdminPanel>

        <AdminPanel title="Venue health" count={venue?.reconciliation?.issues.length ?? 0}>
          <StatusRow
            title={venue?.reconciliation?.label ?? "Venue not checked"}
            detail={venue?.reconciliation?.message ?? "No Hyperliquid practice snapshot is available for this wallet yet."}
            tone={
              venue?.reconciliation?.status === "healthy"
                ? "success"
                : venue?.reconciliation?.status === "blocked"
                  ? "danger"
                  : "warning"
            }
          />
          {venue?.reconciliation ? (
            <div className="grid gap-2 sm:grid-cols-4">
              <SmallMetric label="Submitted" value={String(venue.reconciliation.submittedRequests)} />
              <SmallMetric label="Pending" value={String(venue.reconciliation.pendingRequests)} />
              <SmallMetric label="Errors" value={String(venue.reconciliation.adapterErrors)} />
              <SmallMetric label="Mismatches" value={String(venue.reconciliation.unmatchedPositions + venue.reconciliation.missingOrderIds)} />
            </div>
          ) : null}
        </AdminPanel>

        <AdminPanel title="Moderation queue" count={pendingModeration.length}>
          {pendingModeration.slice(0, 6).map((agent) => (
            <StatusRow
              key={agent.id}
              title={agent.name}
              detail={agent.publishing?.moderation?.reason ?? "Published profile needs marketplace review."}
              tone="warning"
            />
          ))}
          {pendingModeration.length === 0 ? (
            <StatusRow title="No moderation queue" detail="Published profiles are either approved or there are no published agents." tone="success" />
          ) : null}
        </AdminPanel>

        <AdminPanel title="Risky agents" count={riskyAgents.length}>
          {riskyAgents.slice(0, 6).map((agent) => {
            const openTrades = executions.filter(
              (execution) => execution.agentId === agent.id && execution.status === "open",
            ).length;
            const blocked = blockedSignals.filter((proposal) => proposal.agentId === agent.id).length;
            return (
              <StatusRow
                key={agent.id}
                title={agent.name}
                detail={`${agent.status} · ${openTrades} open trade${openTrades === 1 ? "" : "s"} · ${blocked} blocked idea${blocked === 1 ? "" : "s"}`}
                tone={agent.status === "active" ? "warning" : "danger"}
              />
            );
          })}
          {riskyAgents.length === 0 ? (
            <StatusRow title="No risky agents visible" detail="No paused agents, blocked ideas, or open trades are visible right now." tone="success" />
          ) : null}
        </AdminPanel>

        <AdminPanel title="Feedback loop" count={feedback.length}>
          {feedback.slice(0, 5).map((item) => (
            <StatusRow
              key={item.id}
              title={feedbackLabel(item.kind)}
              detail={item.message}
              tone={item.kind === "bug" || item.kind === "trust" ? "warning" : "default"}
            />
          ))}
          {feedback.length === 0 ? (
            <StatusRow title="No beta feedback yet" detail="Tester feedback saved from Agent Trading will appear here." tone="default" />
          ) : null}
        </AdminPanel>

        <AdminPanel title="Market readiness" count={marketReadiness.checks.filter((item) => item.status !== "pass").length}>
          {marketReadiness.checks
            .filter((item) => item.status !== "pass")
            .slice(0, 6)
            .map((item) => (
              <StatusRow key={item.id} title={item.label} detail={item.message} tone={item.status === "block" ? "danger" : "warning"} />
            ))}
        </AdminPanel>
      </section>
    </div>
  );
}

function AdminPanel({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <section className="rounded-card bg-surface-raised p-4 shadow-card-rest">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-text-strong">{title}</h2>
        <span className="rounded-full border border-border-soft bg-canvas px-2 py-1 text-[11px] font-medium text-text-soft">
          {count}
        </span>
      </div>
      <div className="grid gap-2">{children}</div>
    </section>
  );
}

function Metric({
  label,
  value,
  Icon,
}: {
  label: string;
  value: string;
  Icon: LucideIcon;
}) {
  return (
    <div className="rounded-card bg-surface-raised p-3 shadow-card-rest">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-text-soft">{label}</span>
        <Icon className="h-4 w-4 text-accent" aria-hidden="true" />
      </div>
      <p className="mt-2 font-mono text-xl font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function SmallMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-text-soft">{label}</p>
      <p className="mt-1 text-xs font-semibold text-text-strong">{value}</p>
    </div>
  );
}

function StatusRow({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "default";
}) {
  return (
    <div className="rounded-soft border border-border-soft bg-canvas px-3 py-2">
      <div className="flex items-start gap-2">
        {tone === "success" ? (
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden="true" />
        ) : tone === "danger" ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
        ) : tone === "warning" ? (
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-soft" aria-hidden="true" />
        )}
        <div className="min-w-0">
          <p className="break-words text-xs font-semibold text-text-strong">{title}</p>
          <p className="mt-1 break-words text-xs leading-relaxed text-text-soft">{detail}</p>
        </div>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning";
}) {
  return (
    <span
      className={
        tone === "success"
          ? "rounded-full border border-accent/30 bg-accent/[0.08] px-2.5 py-1 text-[11px] font-medium text-accent"
          : "rounded-full border border-warning/30 bg-warning/[0.08] px-2.5 py-1 text-[11px] font-medium text-warning"
      }
    >
      {children}
    </span>
  );
}

function feedbackLabel(kind: AgentBetaFeedbackItem["kind"]): string {
  switch (kind) {
    case "bug":
      return "Bug";
    case "confusing":
      return "Confusing flow";
    case "missing_feature":
      return "Missing feature";
    case "trust":
      return "Trust or safety";
    case "performance":
      return "Performance";
    case "other":
      return "Other";
  }
}

function decodeParam(value: string | undefined): string {
  const raw = value ?? "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
