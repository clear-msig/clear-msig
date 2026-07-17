import {
  recommendAgentAllocation,
  type AgentAllocationRecommendation,
} from "@/lib/agents/allocation";
import { isAgentSessionCurrent } from "@/lib/agents/policyHash";
import type {
  AgentLeaderboardEntry,
  AgentProfile,
  AgentScorecard,
  AgentSessionGrant,
  AgentVaultPolicy,
} from "@/lib/agents/types";

export type AgentFundingAction =
  | "fund"
  | "raise"
  | "lower"
  | "keep"
  | "review";

export interface AgentFundingRecommendation {
  agent: AgentProfile;
  scorecard?: AgentScorecard;
  leaderboard?: AgentLeaderboardEntry;
  currentSession?: AgentSessionGrant;
  allocation: AgentAllocationRecommendation;
  action: AgentFundingAction;
  priority: number;
  headline: string;
  summary: string;
  ctaLabel: string;
}

export interface AgentFundingPlan {
  recommendations: AgentFundingRecommendation[];
  activeAllowances: number;
  actionableCount: number;
  raiseCount: number;
  totalRecommendedNotionalUsd: string;
}

export function buildAgentVaultAllocationHref(input: {
  sourceWallet: string;
  destinationAddress: string;
  agentVaultName: string;
}): string {
  const query = new URLSearchParams({
    recipient: input.destinationAddress,
    note: `Allocate to ${input.agentVaultName}`,
  });
  return `/app/wallet/${encodeURIComponent(input.sourceWallet)}/send?${query.toString()}`;
}

export function buildAgentFundingPlan({
  agents,
  scorecards,
  leaderboard,
  sessions,
  policy,
  now = Date.now(),
}: {
  agents: AgentProfile[];
  scorecards: AgentScorecard[];
  leaderboard: AgentLeaderboardEntry[];
  sessions: AgentSessionGrant[];
  policy: AgentVaultPolicy;
  now?: number;
}): AgentFundingPlan {
  const activeSessions = sessions.filter((session) =>
    isAgentSessionCurrent(session, policy, now),
  );
  const recommendations = agents
    .filter((agent) => agent.status !== "revoked")
    .map((agent) => {
      const scorecard = scorecards.find((item) => item.agentId === agent.id);
      const leader = leaderboard.find((item) => item.agentId === agent.id);
      const currentSession = activeSessions.find(
        (session) => session.agentId === agent.id,
      );
      const allocation = recommendAgentAllocation({
        agent,
        scorecard,
        leaderboard: leader,
        currentSession,
        policy,
        now,
      });
      const action = fundingAction(allocation.action);
      return {
        agent,
        scorecard,
        leaderboard: leader,
        currentSession,
        allocation,
        action,
        priority: fundingPriority(action),
        headline: fundingHeadline(action, allocation),
        summary: fundingSummary(action, allocation),
        ctaLabel: fundingCtaLabel(action, Boolean(currentSession)),
      };
    })
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return (b.leaderboard?.score ?? 0) - (a.leaderboard?.score ?? 0);
    });

  return {
    recommendations,
    activeAllowances: activeSessions.length,
    actionableCount: recommendations.filter((item) =>
      ["fund", "raise", "lower", "review"].includes(item.action),
    ).length,
    raiseCount: recommendations.filter((item) => item.action === "raise").length,
    totalRecommendedNotionalUsd: String(
      recommendations.reduce(
        (total, item) => total + numberValue(item.allocation.limits.maxNotionalUsd),
        0,
      ),
    ),
  };
}

function fundingAction(
  action: AgentAllocationRecommendation["action"],
): AgentFundingAction {
  switch (action) {
    case "promote":
      return "raise";
    case "demote":
      return "lower";
    case "hold":
      return "keep";
    case "review":
      return "review";
    case "start":
      return "fund";
  }
}

function fundingPriority(action: AgentFundingAction): number {
  switch (action) {
    case "raise":
      return 0;
    case "fund":
      return 1;
    case "lower":
      return 2;
    case "review":
      return 3;
    case "keep":
      return 4;
  }
}

function fundingHeadline(
  action: AgentFundingAction,
  allocation: AgentAllocationRecommendation,
): string {
  switch (action) {
    case "raise":
      return `Ready for ${allocation.tier.label}`;
    case "lower":
      return `Reduce to ${allocation.tier.label}`;
    case "keep":
      return `${allocation.tier.label} still fits`;
    case "review":
      return "Review before allowance";
    case "fund":
      return `Start ${allocation.tier.label}`;
  }
}

function fundingSummary(
  action: AgentFundingAction,
  allocation: AgentAllocationRecommendation,
): string {
  const limit = allocation.limits;
  const window = `${limit.sessionHours} hour${limit.sessionHours === 1 ? "" : "s"}`;
  const controls = `${formatUsd(limit.maxNotionalUsd)} per trade, ${limit.maxLeverage}x max, ${limit.maxOpenPositions} open trade${limit.maxOpenPositions === 1 ? "" : "s"}, ${window}`;
  switch (action) {
    case "raise":
      return `Performance supports a larger allowance: ${controls}.`;
    case "lower":
      return `Use a smaller allowance until performance improves: ${controls}.`;
    case "keep":
      return `The current allowance already matches the recommendation: ${controls}.`;
    case "review":
      return `Pause and review settings before giving this trader more room: ${controls}.`;
    case "fund":
      return `Begin with a small bounded allowance: ${controls}.`;
  }
}

function fundingCtaLabel(action: AgentFundingAction, hasSession: boolean): string {
  switch (action) {
    case "raise":
      return "Raise allowance";
    case "lower":
      return "Lower allowance";
    case "keep":
      return hasSession ? "Start trading" : "Review allowance";
    case "review":
      return "Review trader";
    case "fund":
      return "Set allowance";
  }
}

function formatUsd(value: string | number): string {
  const parsed = numberValue(value);
  return `$${parsed.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function numberValue(value: string | number | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
