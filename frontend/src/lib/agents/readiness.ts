import type {
  AgentProfile,
  AgentReadinessAction,
  AgentReadinessItem,
  AgentReadinessItemStatus,
  AgentRiskSnapshot,
  AgentSessionGrant,
  AgentTradingReadiness,
  AgentVaultPolicy,
} from "@/lib/agents/types";
import {
  agentSessionPolicyBindingStatus,
  isAgentSessionCurrent,
} from "@/lib/agents/policyHash";

interface ReadinessArgs {
  agent: AgentProfile;
  policy: AgentVaultPolicy;
  sessions: AgentSessionGrant[];
  risk?: AgentRiskSnapshot | null;
  now?: number;
}

export function buildAgentTradingReadiness({
  agent,
  policy,
  sessions,
  risk,
  now = Date.now(),
}: ReadinessArgs): AgentTradingReadiness {
  const activeSession = sessions.find(
    (session) => session.agentId === agent.id && isAgentSessionCurrent(session, policy, now),
  );
  const staleSession = sessions.find(
    (session) =>
      session.agentId === agent.id &&
      session.status === "active" &&
      session.expiresAt > now &&
      agentSessionPolicyBindingStatus(session, policy) !== "current",
  );
  const items: AgentReadinessItem[] = [];

  addItem(items, {
    id: "risk-limits",
    label: "Safety rules",
    status:
      policy.enabled &&
      !policy.emergencyPaused &&
      hasPositiveUsd(policy.maxNotionalUsd) &&
      policy.maxLeverage > 0 &&
      policy.maxOpenPositionsPerAgent > 0 &&
      policy.maxSessionHours > 0 &&
      hasPositiveUsd(policy.dailyLossCapUsd) &&
      policy.allowedVenues.length > 0 &&
      policy.allowedMarkets.length > 0
        ? "pass"
        : policy.emergencyPaused
          ? "block"
          : "todo",
    message: riskLimitsMessage(policy),
    action: "risk_limits",
  });

  addItem(items, {
    id: "agent-status",
    label: "Trader status",
    status: agent.status === "active" ? "pass" : "block",
    message:
      agent.status === "active"
        ? "This trader is active."
        : agent.status === "paused"
          ? "This trader is paused. Turn it back on before giving it an allowance."
          : "This trader no longer has access. Turn it back on before giving it a new allowance.",
    action: "agent",
  });

  addItem(items, {
    id: "strategy",
    label: "Trading plan",
    status: strategyStatus(agent),
    message: strategyMessage(agent),
    action: "strategy",
  });

  addItem(items, {
    id: "session",
    label: "Practice allowance",
    status: activeSession ? "pass" : staleSession ? "block" : "todo",
    message: activeSession
      ? `The current allowance runs until ${new Date(activeSession.expiresAt).toLocaleString()}.`
      : staleSession
        ? "Your safety rules changed. Review and renew this allowance before trading continues."
      : "Give this trader a practice allowance before it can open practice trades.",
    action: "session",
  });

  addItem(items, {
    id: "capacity",
    label: "Open trade limit",
    status: capacityStatus(policy, risk),
    message: capacityMessage(policy, risk),
    action: "agent",
  });

  addItem(items, {
    id: "daily-loss",
    label: "Daily loss limit",
    status: dailyLossStatus(policy, risk),
    message: dailyLossMessage(policy, risk),
    action: "agent",
  });

  addItem(items, {
    id: "cooldown",
    label: "Rest time between trades",
    status: cooldownStatus(policy, risk, now),
    message: cooldownMessage(policy, risk, now),
    action: "agent",
  });

  const blocking = items.filter((item) => item.status === "block");
  const todos = items.filter((item) => item.status === "todo");
  const passed = items.filter((item) => item.status === "pass").length;
  const score = Math.round((passed / items.length) * 100);
  const status =
    blocking.length > 0 ? "blocked" : todos.length > 0 ? "needs_setup" : "ready";
  const primaryAction = (blocking[0] ?? todos[0])?.action ?? "none";

  return {
    agentId: agent.id,
    status,
    headline:
      status === "ready"
        ? "Ready to practice"
        : status === "blocked"
          ? "Trading has stopped"
          : "A few steps remain",
    summary:
      status === "ready"
        ? "This trader can open practice trades when an idea fits your safety rules."
        : status === "blocked"
          ? blocking[0]?.message ?? "Review what stopped trading before continuing."
          : todos[0]?.message ?? "Finish the next step before this trader can begin.",
    score,
    primaryAction,
    items,
  };
}

export function agentSessionSetupIssue(agent: AgentProfile): string | null {
  return strategyStatus(agent) === "pass" ? null : strategyMessage(agent);
}

function addItem(
  items: AgentReadinessItem[],
  item: {
    id: string;
    label: string;
    status: AgentReadinessItemStatus;
    message: string;
    action: AgentReadinessAction;
  },
): void {
  items.push(item);
}

function riskLimitsMessage(policy: AgentVaultPolicy): string {
  if (policy.emergencyPaused) {
    return "All automated trading is stopped. Allow trading again when you are ready.";
  }
  if (!policy.enabled) {
    return "Automated trading is off. Turn it on in Safety rules.";
  }
  if (
    !hasPositiveUsd(policy.maxNotionalUsd) ||
    policy.maxLeverage <= 0 ||
    policy.maxOpenPositionsPerAgent <= 0 ||
    policy.maxSessionHours <= 0 ||
    !hasPositiveUsd(policy.dailyLossCapUsd) ||
    policy.allowedVenues.length === 0 ||
    policy.allowedMarkets.length === 0
  ) {
    return "Choose where it may trade, what it may trade, its maximum size, and its loss limit.";
  }
  return "Your safety rules are on.";
}

function strategyStatus(agent: AgentProfile): AgentReadinessItemStatus {
  const strategy = agent.strategy;
  if (!strategy) return "todo";
  if (strategy.mode === "read_only") return "todo";
  if (
    strategy.allowedMarkets.length === 0 ||
    !strategy.entryRules.trim() ||
    !strategy.exitRules.trim() ||
    !strategy.riskRules.trim() ||
    !strategy.executionProtocol.trim() ||
    !strategy.killSwitchRules.trim()
  ) {
    return "todo";
  }
  return "pass";
}

function strategyMessage(agent: AgentProfile): string {
  const strategy = agent.strategy;
  if (!strategy) {
    return "Describe when this trader may enter, exit, take risk, and stop.";
  }
  if (strategy.mode === "read_only") {
    return "This trader can suggest ideas only. Allow practice trading when you want it to act.";
  }
  if (strategy.allowedMarkets.length === 0) {
    return "Choose the markets this trader is allowed to use.";
  }
  if (
    !strategy.entryRules.trim() ||
    !strategy.exitRules.trim() ||
    !strategy.riskRules.trim() ||
    !strategy.executionProtocol.trim() ||
    !strategy.killSwitchRules.trim()
  ) {
    return "Finish when it may enter, when it must exit, how much risk it may take, and when it must stop.";
  }
  return "The trading plan is complete.";
}

function capacityStatus(
  policy: AgentVaultPolicy,
  risk?: AgentRiskSnapshot | null,
): AgentReadinessItemStatus {
  const openPositions = risk?.openPositions ?? 0;
  return policy.maxOpenPositionsPerAgent > 0 &&
    openPositions >= policy.maxOpenPositionsPerAgent
    ? "block"
    : "pass";
}

function capacityMessage(policy: AgentVaultPolicy, risk?: AgentRiskSnapshot | null): string {
  const openPositions = risk?.openPositions ?? 0;
  if (
    policy.maxOpenPositionsPerAgent > 0 &&
    openPositions >= policy.maxOpenPositionsPerAgent
  ) {
    return `This trader already has ${openPositions} open trade(s), which is the limit you chose.`;
  }
  return `${openPositions} open trade(s). It may open another within your rules.`;
}

function dailyLossStatus(
  policy: AgentVaultPolicy,
  risk?: AgentRiskSnapshot | null,
): AgentReadinessItemStatus {
  const cap = positiveNumber(policy.dailyLossCapUsd);
  const pnl = numberOrNull(risk?.dailyRealizedPnlUsd);
  return cap != null && pnl != null && pnl <= -cap ? "block" : "pass";
}

function dailyLossMessage(policy: AgentVaultPolicy, risk?: AgentRiskSnapshot | null): string {
  const cap = positiveNumber(policy.dailyLossCapUsd);
  const pnl = numberOrNull(risk?.dailyRealizedPnlUsd) ?? 0;
  if (cap != null && pnl <= -cap) {
    return `Today is ${formatSignedUsd(pnl)}. This reached the ${formatUsd(cap)} daily loss limit.`;
  }
  return `Today is ${formatSignedUsd(pnl)}. The daily loss limit is ${formatUsd(cap ?? 0)}.`;
}

function cooldownStatus(
  policy: AgentVaultPolicy,
  risk: AgentRiskSnapshot | null | undefined,
  now: number,
): AgentReadinessItemStatus {
  if (!policy.cooldownSeconds || !risk?.lastTradeAt) return "pass";
  return now - risk.lastTradeAt < policy.cooldownSeconds * 1000 ? "block" : "pass";
}

function cooldownMessage(
  policy: AgentVaultPolicy,
  risk: AgentRiskSnapshot | null | undefined,
  now: number,
): string {
  if (!policy.cooldownSeconds) return "No rest time is required between trades.";
  if (!risk?.lastTradeAt) return "This trader has not traded recently.";
  const remainingMs = policy.cooldownSeconds * 1000 - (now - risk.lastTradeAt);
  if (remainingMs > 0) {
    return `This trader must wait ${Math.ceil(remainingMs / 60_000)} more minute(s) before trading again.`;
  }
  return "This trader may trade again.";
}

function hasPositiveUsd(value: string): boolean {
  return positiveNumber(value) != null;
}

function positiveNumber(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function numberOrNull(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function formatSignedUsd(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "$0";
  return `${value > 0 ? "+" : "-"}$${Math.abs(value).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}
