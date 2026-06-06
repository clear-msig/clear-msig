"use client";

import type {
  AgentTradeProposal,
  AgentServerExecutionReadiness,
} from "@/lib/agents";
import type {
  HyperliquidTestnetAccountProbe,
  HyperliquidTestnetAccountSnapshot,
  HyperliquidTestnetExecutorProbe,
} from "@/lib/agents/serverHyperliquidTestnet";

export type AgentVenueReadiness = AgentServerExecutionReadiness & {
  accountProbe?: HyperliquidTestnetAccountProbe | null;
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null;
  executorProbe?: HyperliquidTestnetExecutorProbe | null;
  requests?: Array<{
    status: string;
    request: {
      walletName: string;
      agentId: string;
      proposalId: string;
      venue: AgentTradeProposal["venue"];
    };
  }>;
};

export interface AgentServerExecutionResult {
  ok: boolean;
  message: string;
  status: number;
  readiness?: AgentServerExecutionReadiness;
  serverRequest?: {
    id: string;
    status: string;
    message: string;
  };
  duplicate?: boolean;
}

export async function loadAgentVenueReadiness(
  venue: AgentTradeProposal["venue"],
  options: { walletName?: string; agentId?: string } = {},
): Promise<AgentVenueReadiness | null> {
  const response = await fetch(apiPath(venue, options));
  const body = (await response.json()) as {
    readiness?: AgentServerExecutionReadiness;
    accountProbe?: HyperliquidTestnetAccountProbe | null;
    accountSnapshot?: HyperliquidTestnetAccountSnapshot | null;
    executorProbe?: HyperliquidTestnetExecutorProbe | null;
    requests?: AgentVenueReadiness["requests"];
  };
  if (!response.ok) return null;
  return body.readiness
    ? {
        ...body.readiness,
        accountProbe: body.accountProbe,
        accountSnapshot: body.accountSnapshot,
        executorProbe: body.executorProbe,
        requests: Array.isArray(body.requests) ? body.requests : [],
      }
    : null;
}

export async function submitAgentVenueExecution(
  proposal: AgentTradeProposal,
): Promise<AgentServerExecutionResult> {
  const response = await fetch(apiPath(proposal.venue), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      walletName: proposal.walletName,
      agentId: proposal.agentId,
      proposalId: proposal.id,
      venue: proposal.venue,
      market: proposal.market,
      side: proposal.side,
      orderType: proposal.orderType,
      notionalUsd: proposal.notionalUsd,
      leverage: proposal.leverage,
      approvedAt: proposal.updatedAt,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
    ok?: unknown;
    readiness?: AgentServerExecutionReadiness;
    serverRequest?: {
      id?: unknown;
      status?: unknown;
      message?: unknown;
    };
    duplicate?: unknown;
  };
  return {
    ok: response.ok && body.ok === true,
    message:
      typeof body.error === "string"
        ? body.error
        : response.ok
          ? "Venue accepted the trade request."
          : response.statusText,
    status: response.status,
    readiness: body.readiness,
    serverRequest:
      typeof body.serverRequest?.id === "string" &&
      typeof body.serverRequest.status === "string" &&
      typeof body.serverRequest.message === "string"
        ? {
            id: body.serverRequest.id,
            status: body.serverRequest.status,
            message: body.serverRequest.message,
          }
        : undefined,
    duplicate: body.duplicate === true,
  };
}

function apiPath(
  venue: AgentTradeProposal["venue"],
  options: { walletName?: string; agentId?: string } = {},
): string {
  const path = `/api/agent-execution/${encodeURIComponent(venue)}`;
  if (!options.walletName || !options.agentId) return path;
  const query = new URLSearchParams({
    walletName: options.walletName,
    agentId: options.agentId,
  });
  return `${path}?${query.toString()}`;
}
