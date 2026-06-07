import {
  agentSessionPolicyBindingStatus,
  isAgentSessionCurrent,
} from "@/lib/agents/policyHash";
import type {
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

export type AgentBetaReadinessStatus = "ready" | "needs_setup" | "blocked";
export type AgentBetaReadinessCheckStatus = "pass" | "todo" | "block";

export interface AgentBetaReadinessCheck {
  id: string;
  label: string;
  status: AgentBetaReadinessCheckStatus;
  message: string;
  href?: string;
}

export interface AgentBetaReadinessInput {
  agents: AgentProfile[];
  policy: AgentVaultPolicy;
  sessions: AgentSessionGrant[];
  executions: AgentExecutionRecord[];
  proposals: AgentTradeProposal[];
  approvals: AgentOwnerApproval[];
  connections: AgentConnectionKit[];
  backend: {
    state: "checking" | "synced" | "local";
    storage?: "redis" | "memory";
  };
  marketData: {
    openMarkets: number;
    pricedOpenMarkets: number;
  };
  venue: {
    state: "checking" | "connected" | "needs_setup" | "unavailable";
  };
  walletHref: string;
  now?: number;
}

export interface AgentBetaReadiness {
  status: AgentBetaReadinessStatus;
  score: number;
  headline: string;
  summary: string;
  checks: AgentBetaReadinessCheck[];
}

export function buildAgentBetaReadiness({
  agents,
  policy,
  sessions,
  executions,
  proposals,
  approvals,
  connections,
  backend,
  marketData,
  venue,
  walletHref,
  now = Date.now(),
}: AgentBetaReadinessInput): AgentBetaReadiness {
  const activeAgents = agents.filter((agent) => agent.status === "active");
  const completeStrategyAgents = activeAgents.filter(hasCompleteStrategy);
  const currentSessions = sessions.filter((session) =>
    isAgentSessionCurrent(session, policy, now),
  );
  const staleSessions = sessions.filter(
    (session) =>
      session.status === "active" &&
      session.expiresAt > now &&
      agentSessionPolicyBindingStatus(session, policy) !== "current",
  );
  const automaticConnections = connections.filter(
    (kit) => kit.autoImportSessionSignals,
  );
  const automaticApprovals = approvals.filter(
    (approval) => approval.action === "start_automatic_trading",
  );
  const openTrades = executions.filter((execution) => execution.status === "open");
  const checks: AgentBetaReadinessCheck[] = [
    {
      id: "agents",
      label: "Active agents",
      status: completeStrategyAgents.length > 0 ? "pass" : activeAgents.length > 0 ? "todo" : "block",
      message:
        completeStrategyAgents.length > 0
          ? `${completeStrategyAgents.length} active agent${completeStrategyAgents.length === 1 ? "" : "s"} have a complete trading plan.`
          : activeAgents.length > 0
            ? "At least one active agent still needs a complete trading plan."
            : "Add or reactivate an agent before inviting public testers.",
      href: `${walletHref}/agents/library`,
    },
    {
      id: "safety",
      label: "Safety rules",
      status:
        policy.enabled &&
        !policy.emergencyPaused &&
        policy.allowedVenues.length > 0 &&
        policy.allowedMarkets.length > 0 &&
        positive(policy.maxNotionalUsd) &&
        positive(policy.dailyLossCapUsd)
          ? "pass"
          : policy.emergencyPaused
            ? "block"
            : "todo",
      message: policy.emergencyPaused
        ? "The kill switch is on. Public testers cannot start new agent trades."
        : policy.enabled
          ? "Safety rules are configured for public beta."
          : "Turn on safety rules before public testing.",
      href: `${walletHref}/agents/policy`,
    },
    {
      id: "allowances",
      label: "Current allowances",
      status: currentSessions.length > 0 ? "pass" : staleSessions.length > 0 ? "block" : "todo",
      message:
        currentSessions.length > 0
          ? `${currentSessions.length} current allowance${currentSessions.length === 1 ? "" : "s"} are active.`
          : staleSessions.length > 0
            ? "Some allowances were issued under older safety rules and need renewal."
            : "Give at least one small paper allowance for the beta path.",
      href: `${walletHref}/agents/sessions/new`,
    },
    {
      id: "automatic",
      label: "Automatic trading",
      status: automaticConnections.length > 0 ? "pass" : automaticApprovals.length > 0 ? "todo" : "todo",
      message:
        automaticConnections.length > 0
          ? `${automaticConnections.length} agent${automaticConnections.length === 1 ? "" : "s"} can auto-import allowed signals.`
          : automaticApprovals.length > 0
            ? "Approval exists, but no connection is currently set to auto-import signals."
            : "Turn on automatic trading for at least one agent before broader beta testing.",
      href: `${walletHref}/agents/start`,
    },
    {
      id: "persistence",
      label: "Durable saving",
      status:
        backend.state === "synced" && backend.storage === "redis"
          ? "pass"
          : backend.state === "synced"
            ? "todo"
            : backend.state === "checking"
              ? "todo"
              : "block",
      message:
        backend.state === "synced" && backend.storage === "redis"
          ? "Backend state is Redis-backed."
          : backend.state === "synced"
            ? "Backend state is available, but it is using development memory storage."
            : backend.state === "checking"
              ? "ClearSig is checking backend persistence."
              : "Backend persistence is unavailable; testers would be limited to this browser.",
    },
    {
      id: "market-data",
      label: "Open trade pricing",
      status:
        marketData.openMarkets === 0 ||
        marketData.pricedOpenMarkets >= marketData.openMarkets
          ? "pass"
          : "todo",
      message:
        marketData.openMarkets === 0
          ? "No open trades need pricing right now."
          : `${marketData.pricedOpenMarkets} of ${marketData.openMarkets} open market${marketData.openMarkets === 1 ? "" : "s"} have pricing.`,
      href: `${walletHref}/agents/trades`,
    },
    {
      id: "venue",
      label: "Venue setup",
      status: venue.state === "connected" ? "pass" : venue.state === "unavailable" ? "todo" : "todo",
      message:
        venue.state === "connected"
          ? "Outside testnet venue checks are connected."
          : venue.state === "checking"
            ? "Checking outside testnet venue setup."
            : venue.state === "unavailable"
              ? "Outside venue diagnostics are unavailable; built-in paper trading can still be tested."
              : "Outside testnet venue needs setup; built-in paper trading can still be tested.",
      href: `${walletHref}/agents/start?venue=hyperliquid_testnet`,
    },
    {
      id: "activity",
      label: "Testing activity",
      status:
        proposals.length > 0 || executions.length > 0 || openTrades.length > 0
          ? "pass"
          : "todo",
      message:
        executions.length > 0
          ? `${executions.length} practice trade${executions.length === 1 ? "" : "s"} are recorded.`
          : proposals.length > 0
            ? `${proposals.length} trade idea${proposals.length === 1 ? "" : "s"} are recorded.`
            : "Seed or create at least one paper trade so testers can inspect the full loop.",
      href: `${walletHref}/agents/trades`,
    },
  ];
  const passed = checks.filter((check) => check.status === "pass").length;
  const blocked = checks.filter((check) => check.status === "block");
  const todos = checks.filter((check) => check.status === "todo");
  const status =
    blocked.length > 0 ? "blocked" : todos.length > 0 ? "needs_setup" : "ready";
  return {
    status,
    score: Math.round((passed / checks.length) * 100),
    headline:
      status === "ready"
        ? "Ready for public beta"
        : status === "blocked"
          ? "Fix launch blockers first"
          : "Controlled beta ready with caveats",
    summary:
      status === "ready"
        ? "Agent Trading has the core safety, persistence, pricing, and activity signals needed for public testing."
        : status === "blocked"
          ? blocked[0]?.message ?? "A blocker must be resolved before public testing."
          : todos[0]?.message ?? "A few setup items remain before wider testing.",
    checks,
  };
}

function hasCompleteStrategy(agent: AgentProfile): boolean {
  const strategy = agent.strategy;
  return Boolean(
    strategy &&
      strategy.mode !== "read_only" &&
      strategy.allowedMarkets.length > 0 &&
      strategy.entryRules.trim() &&
      strategy.exitRules.trim() &&
      strategy.riskRules.trim() &&
      strategy.executionProtocol.trim() &&
      strategy.killSwitchRules.trim(),
  );
}

function positive(value: string): boolean {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}
