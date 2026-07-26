import type {
  AgentPolicyEvaluation,
  AgentPolicyViolation,
  AgentProfile,
  AgentRiskSnapshot,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
  TradingVenue,
} from "@/lib/agents/types";
import {
  agentSessionPolicyBindingStatus,
  bindAgentVaultPolicyHash,
} from "@/lib/agents/policyHash";

interface EvaluateArgs {
  agent: AgentProfile;
  proposal: AgentTradeProposal;
  policy: AgentVaultPolicy;
  session?: AgentSessionGrant | null;
  risk?: AgentRiskSnapshot;
  now?: number;
}

export function evaluateAgentTradeProposal({
  agent,
  proposal,
  policy,
  session,
  risk,
  now = Date.now(),
}: EvaluateArgs): AgentPolicyEvaluation {
  const violations: AgentPolicyViolation[] = [];
  const market = normalizeMarket(proposal.market);
  const notionalUsd = parsePositiveDecimal(proposal.notionalUsd);
  const leverage = proposal.leverage;

  const addBlock = (code: AgentPolicyViolation["code"], message: string) => {
    violations.push({ code, message, severity: "block" });
  };
  const addApproval = (code: AgentPolicyViolation["code"], message: string) => {
    violations.push({ code, message, severity: "approval" });
  };

  if (!policy.enabled) {
    addBlock("policy_disabled", "Agent trading policy is disabled for this vault.");
  }
  if (
    parsePositiveDecimal(policy.maxNotionalUsd) == null ||
    !Number.isFinite(policy.maxLeverage) ||
    policy.maxLeverage <= 0 ||
    !Number.isFinite(policy.maxOpenPositionsPerAgent) ||
    policy.maxOpenPositionsPerAgent <= 0 ||
    !Number.isFinite(policy.maxSessionHours) ||
    policy.maxSessionHours <= 0 ||
    parsePositiveDecimal(policy.dailyLossCapUsd) == null
  ) {
    addBlock(
      "policy_incomplete",
      "Finish the wallet safety rules before allowing trading.",
    );
  }
  if (policy.emergencyPaused) {
    addBlock("emergency_paused", "Agent trading is paused by the vault kill switch.");
  }
  if (agent.status !== "active") {
    addBlock("agent_not_active", "Agent is not active.");
  }
  if (proposal.expiresAt <= now) {
    addBlock("proposal_expired", "Trade proposal has expired.");
  }

  evaluateStrategy({
    agent,
    proposal,
    session,
    market,
    violations,
    addBlock,
    addApproval,
  });
  evaluateSession({ session, proposal, policy, now, violations });
  evaluateVenueAndMarket({ proposal, policy, session, market, violations });

  if (notionalUsd == null) {
    addBlock("invalid_notional", "Trade notional must be a positive USD amount.");
  } else {
    const maxNotional = minDefinedPositive([
      parsePositiveDecimal(policy.maxNotionalUsd),
      session ? parsePositiveDecimal(session.maxNotionalUsd) : null,
    ]);
    if (maxNotional != null && notionalUsd > maxNotional) {
      addBlock(
        "notional_too_large",
        `Trade notional ${formatUsd(notionalUsd)} exceeds the ${formatUsd(maxNotional)} limit.`,
      );
    }
  }

  if (!Number.isFinite(leverage) || leverage <= 0) {
    addBlock("invalid_leverage", "Leverage must be greater than zero.");
  } else {
    const maxLeverage = minDefinedPositive([
      policy.maxLeverage,
      session?.maxLeverage ?? null,
    ]);
    if (maxLeverage != null && leverage > maxLeverage) {
      addBlock(
        "leverage_too_high",
        `Trade leverage ${leverage}x exceeds the ${maxLeverage}x limit.`,
      );
    }
  }

  if (policy.requireStopLoss && !hasValue(proposal.stopLossPrice)) {
    addBlock("stop_loss_required", "This vault requires a stop loss for agent trades.");
  }
  if (policy.requireTakeProfit && !hasValue(proposal.takeProfitPrice)) {
    addBlock("take_profit_required", "This vault requires a take profit for agent trades.");
  }

  const openPositions = risk?.openPositions ?? 0;
  const maxOpenPositions = minDefinedPositive([
    policy.maxOpenPositionsPerAgent,
    session?.maxOpenPositions ?? null,
  ]);
  if (maxOpenPositions != null && openPositions >= maxOpenPositions) {
    addBlock(
      "too_many_open_positions",
      `Agent already has ${openPositions} open position(s), at the configured limit.`,
    );
  }

  if (
    policy.cooldownSeconds > 0 &&
    risk?.lastTradeAt &&
    now - risk.lastTradeAt < policy.cooldownSeconds * 1000
  ) {
    addBlock("cooldown_active", "Agent trade cooldown is still active.");
  }

  const dailyLossCap = parsePositiveDecimal(policy.dailyLossCapUsd);
  const dailyPnl = parseDecimal(risk?.dailyRealizedPnlUsd);
  if (dailyLossCap != null && dailyPnl != null && dailyPnl <= -dailyLossCap) {
    addBlock(
      "daily_loss_cap_reached",
      `Daily loss cap ${formatUsd(dailyLossCap)} has been reached for this agent.`,
    );
  }

  const hasBlock = violations.some((violation) => violation.severity === "block");
  const hasApproval = violations.some((violation) => violation.severity === "approval");

  return {
    decision:
      hasBlock
        ? "blocked"
        : hasApproval
          ? "requires_human_approval"
          : session?.status === "active"
          ? "allowed"
          : "requires_human_approval",
    violations,
    normalized: {
      market,
      notionalUsd: notionalUsd ?? 0,
      leverage: Number.isFinite(leverage) ? leverage : 0,
      venue: proposal.venue,
    },
  };
}

function evaluateStrategy({
  agent,
  proposal,
  session,
  market,
  violations,
  addBlock,
  addApproval,
}: {
  agent: AgentProfile;
  proposal: AgentTradeProposal;
  session?: AgentSessionGrant | null;
  market: string;
  violations: AgentPolicyViolation[];
  addBlock: (code: AgentPolicyViolation["code"], message: string) => void;
  addApproval: (code: AgentPolicyViolation["code"], message: string) => void;
}) {
  const strategy = agent.strategy;
  const sessionActive = session?.status === "active";
  if (!strategy) {
    if (sessionActive) {
      addApproval(
        "strategy_missing",
        "Add a strategy playbook before this agent can use bounded session execution.",
      );
    }
    return;
  }

  const strategyMarkets = strategy.allowedMarkets.map(normalizeMarket);
  if (strategyMarkets.length > 0 && !strategyMarkets.includes(market)) {
    addBlock(
      "strategy_market_not_allowed",
      `Market ${market} is not allowed by this agent's strategy playbook.`,
    );
  }

  if (strategy.mode === "read_only" && sessionActive) {
    addApproval(
      "strategy_mode_read_only",
      "This agent is in read-only mode, so the signal needs human approval.",
    );
  }

  if (strategy.mode === "paper" && proposal.venue === "bulktrade_mock") {
    addBlock(
      "strategy_venue_not_allowed",
      "This practice trader is not prepared for bulk practice trades.",
    );
  }
}

function evaluateSession({
  session,
  proposal,
  policy,
  now,
  violations,
}: {
  session?: AgentSessionGrant | null;
  proposal: AgentTradeProposal;
  policy: AgentVaultPolicy;
  now: number;
  violations: AgentPolicyViolation[];
}) {
  if (!session) {
    return;
  }
  if (session.walletName !== proposal.walletName || session.agentId !== proposal.agentId) {
    violations.push({
      code: "session_missing",
      message: "Session grant does not belong to this agent and vault.",
      severity: "block",
    });
    return;
  }
  if (session.status !== "active") {
    violations.push({
      code: "session_inactive",
      message: "Agent session is not active.",
      severity: "block",
    });
  }
  if (session.expiresAt <= now) {
    violations.push({
      code: "session_expired",
      message: "Agent session has expired.",
      severity: "block",
    });
  }
  const bindingStatus = agentSessionPolicyBindingStatus(session, policy);
  if (bindingStatus !== "current") {
    violations.push({
      code: "session_policy_stale",
      message:
        bindingStatus === "missing"
          ? "Agent session is missing its policy commitment. Renew it before bounded execution."
          : "Agent session was issued under an older vault policy. Renew it before bounded execution.",
      severity: "approval",
    });
  }
  if (policy.maxSessionHours > 0) {
    const maxSessionMs = policy.maxSessionHours * 60 * 60 * 1000;
    if (session.expiresAt - session.startsAt > maxSessionMs) {
      violations.push({
        code: "session_expired",
        message: "Agent session exceeds this vault's maximum session duration.",
        severity: "block",
      });
    }
  }
}

function evaluateVenueAndMarket({
  proposal,
  policy,
  session,
  market,
  violations,
}: {
  proposal: AgentTradeProposal;
  policy: AgentVaultPolicy;
  session?: AgentSessionGrant | null;
  market: string;
  violations: AgentPolicyViolation[];
}) {
  const allowedVenues = intersectOrPolicy(policy.allowedVenues, session?.allowedVenues);
  if (!allowedVenues.includes(proposal.venue)) {
    violations.push({
      code: "venue_not_allowed",
      message: "This practice account is not allowed by the current safety rules and allowance.",
      severity: "block",
    });
  }

  const allowedMarkets = intersectOrPolicy(
    policy.allowedMarkets.map(normalizeMarket),
    session?.allowedMarkets?.map(normalizeMarket),
  );
  if (!allowedMarkets.includes(market)) {
    violations.push({
      code: "market_not_allowed",
      message: `${market} is not allowed by the current safety rules and allowance.`,
      severity: "block",
    });
  }
}

function intersectOrPolicy<T>(policyValues: T[], sessionValues: T[] | undefined): T[] {
  if (!sessionValues || sessionValues.length === 0) return policyValues;
  return policyValues.filter((value) => sessionValues.includes(value));
}

function parsePositiveDecimal(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDecimal(value: string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minDefinedPositive(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0,
  );
  if (valid.length === 0) return null;
  return Math.min(...valid);
}

function normalizeMarket(market: string): string {
  return market.trim().toUpperCase();
}

function hasValue(value: string | null | undefined): boolean {
  return value != null && value.trim().length > 0;
}

function formatUsd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function defaultAgentVaultPolicy(
  walletName: string,
  now = Date.now(),
): AgentVaultPolicy {
  return bindAgentVaultPolicyHash({
    id: `agent-policy:${walletName}`,
    walletName,
    enabled: true,
    emergencyPaused: false,
    allowedVenues: ["mock_perps" satisfies TradingVenue],
    allowedMarkets: ["BTC-PERP", "ETH-PERP", "SOL-PERP"],
    maxNotionalUsd: "500",
    maxLeverage: 2,
    requireStopLoss: true,
    requireTakeProfit: false,
    maxOpenPositionsPerAgent: 1,
    cooldownSeconds: 300,
    maxSessionHours: 24,
    dailyLossCapUsd: "100",
    createdAt: now,
    updatedAt: now,
    version: 1,
  });
}
