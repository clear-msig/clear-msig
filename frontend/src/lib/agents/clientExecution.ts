"use client";

import type {
  AgentTradeProposal,
  AgentServerExecutionReadiness,
} from "@/lib/agents";
import type {
  HyperliquidTestnetAccountProbe,
  HyperliquidTestnetAccountSnapshot,
  HyperliquidTestnetExecutorProbe,
  HyperliquidTestnetOrderArtifact,
} from "@/lib/agents/serverHyperliquidTestnet";

export type AgentVenueReadiness = AgentServerExecutionReadiness & {
  accountProbe?: HyperliquidTestnetAccountProbe | null;
  accountSnapshot?: HyperliquidTestnetAccountSnapshot | null;
  executorProbe?: HyperliquidTestnetExecutorProbe | null;
  requests?: Array<{
    id?: string;
    status: string;
    message?: string;
    readinessState?: string;
    artifact?: HyperliquidTestnetOrderArtifact;
    createdAt?: number;
    updatedAt?: number;
    request: {
      walletName: string;
      agentId: string;
      proposalId: string;
      venue: AgentTradeProposal["venue"];
      market?: string;
      side?: AgentTradeProposal["side"];
      notionalUsd?: string;
      leverage?: number;
    };
  }>;
};

export type AgentVenueRequestRecord = NonNullable<AgentVenueReadiness["requests"]>[number];

export interface AgentVenueRequestReconciliation {
  state:
    | "not_submitted"
    | "running_on_exchange"
    | "not_open_on_exchange"
    | "waiting_for_account";
  label: string;
  message: string;
}

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
  options: { walletName?: string; agentId?: string; accountAddress?: string } = {},
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

export function reconcileAgentVenueRequest(
  request: AgentVenueRequestRecord,
  accountSnapshot: HyperliquidTestnetAccountSnapshot | null | undefined,
): AgentVenueRequestReconciliation {
  if (request.status !== "submitted") {
    return {
      state: "not_submitted",
      label: "Not submitted",
      message: request.message ?? "ClearSig has not submitted this request to the venue.",
    };
  }
  if (!accountSnapshot || accountSnapshot.state === "missing_address" || accountSnapshot.state === "unavailable") {
    return {
      state: "waiting_for_account",
      label: "Checking venue",
      message: accountSnapshot?.message ?? "ClearSig is waiting for the venue account state.",
    };
  }
  const market = request.request.market?.toUpperCase();
  const side = request.request.side;
  const matchingPosition = accountSnapshot.positions.find(
    (position) =>
      position.market.toUpperCase() === market &&
      (!side || position.side === side),
  );
  if (matchingPosition) {
    return {
      state: "running_on_exchange",
      label: "Running",
      message: `${matchingPosition.market} ${matchingPosition.side} is open on Hyperliquid with ${formatSignedUsd(matchingPosition.unrealizedPnlUsd ?? "0")} live P/L.`,
    };
  }
  return {
    state: "not_open_on_exchange",
    label: "Not open now",
    message:
      "ClearSig submitted this request, but the matching Hyperliquid position is not open now. It may have closed, failed at the venue, or not filled.",
  };
}

function apiPath(
  venue: AgentTradeProposal["venue"],
  options: { walletName?: string; agentId?: string; accountAddress?: string } = {},
): string {
  const path = `/api/agent-execution/${encodeURIComponent(venue)}`;
  const query = new URLSearchParams();
  if (options.walletName && options.agentId) {
    query.set("walletName", options.walletName);
    query.set("agentId", options.agentId);
  }
  if ("accountAddress" in options && options.accountAddress) {
    query.set("accountAddress", options.accountAddress);
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}

function formatSignedUsd(value: string): string {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed === 0) return "$0";
  return `${parsed > 0 ? "+" : "-"}$${Math.abs(parsed).toLocaleString("en-US", {
    maximumFractionDigits: 2,
  })}`;
}
