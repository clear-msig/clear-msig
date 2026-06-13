"use client";

import type {
  AgentTradeProposal,
  AgentServerExecutionReadiness,
} from "@/lib/agents";
import type { AgentVenueReconciliationSummary } from "@/lib/agents/venueReconciliation";
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
  reconciliation?: AgentVenueReconciliationSummary | null;
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

export const AGENT_VENUE_REALTIME_POLL_MS = 10_000;

export interface AgentVenueRequestReconciliation {
  state:
    | "not_submitted"
    | "submitted"
    | "open_on_venue"
    | "not_found"
    | "executor_error"
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
    reconciliation?: AgentVenueReconciliationSummary | null;
    requests?: AgentVenueReadiness["requests"];
  };
  if (!response.ok) return null;
  return body.readiness
    ? {
        ...body.readiness,
        accountProbe: body.accountProbe,
        accountSnapshot: body.accountSnapshot,
        executorProbe: body.executorProbe,
        reconciliation: body.reconciliation ?? null,
        requests: Array.isArray(body.requests) ? body.requests : [],
      }
    : null;
}

export async function loadAgentVenueReadinessForAgents(
  venue: AgentTradeProposal["venue"],
  options: {
    walletName: string;
    agentIds: string[];
    accountAddress?: string;
  },
): Promise<AgentVenueReadiness | null> {
  const uniqueAgentIds = Array.from(new Set(options.agentIds.filter(Boolean)));
  if (uniqueAgentIds.length === 0) {
    return loadAgentVenueReadiness(venue, {
      accountAddress: options.accountAddress,
    });
  }
  const results = await Promise.all(
    uniqueAgentIds.map((agentId) =>
      loadAgentVenueReadiness(venue, {
        walletName: options.walletName,
        agentId,
        accountAddress: options.accountAddress,
      }).catch(() => null),
    ),
  );
  const primary = results.find(Boolean) ?? null;
  if (!primary) return null;
  return {
    ...primary,
    requests: results.flatMap((readiness) => readiness?.requests ?? []),
    reconciliation: primary.reconciliation
      ? {
          ...primary.reconciliation,
          totalRequests: results.reduce(
            (sum, readiness) => sum + (readiness?.reconciliation?.totalRequests ?? 0),
            0,
          ),
          submittedRequests: results.reduce(
            (sum, readiness) => sum + (readiness?.reconciliation?.submittedRequests ?? 0),
            0,
          ),
          pendingRequests: results.reduce(
            (sum, readiness) => sum + (readiness?.reconciliation?.pendingRequests ?? 0),
            0,
          ),
          rejectedRequests: results.reduce(
            (sum, readiness) => sum + (readiness?.reconciliation?.rejectedRequests ?? 0),
            0,
          ),
          adapterErrors: results.reduce(
            (sum, readiness) => sum + (readiness?.reconciliation?.adapterErrors ?? 0),
            0,
          ),
          issues: results.flatMap((readiness) => readiness?.reconciliation?.issues ?? []),
        }
      : null,
  };
}

export function startAgentVenueReadinessPolling({
  venue,
  options = {},
  intervalMs = AGENT_VENUE_REALTIME_POLL_MS,
  load,
  onUpdate,
  onError,
}: {
  venue: AgentTradeProposal["venue"];
  options?: { walletName?: string; agentId?: string; accountAddress?: string };
  intervalMs?: number;
  load?: () => Promise<AgentVenueReadiness | null>;
  onUpdate: (readiness: AgentVenueReadiness | null) => void;
  onError?: (error: unknown) => void;
}): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  const tick = async () => {
    try {
      const readiness = load
        ? await load()
        : await loadAgentVenueReadiness(venue, options);
      if (!cancelled) onUpdate(readiness);
    } catch (error) {
      if (!cancelled) {
        onUpdate(null);
        onError?.(error);
      }
    }
  };
  void tick();
  timer = setInterval(() => {
    void tick();
  }, intervalMs);
  return () => {
    cancelled = true;
    if (timer) clearInterval(timer);
  };
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
  if (request.status === "adapter_error") {
    return {
      state: "executor_error",
      label: "Executor error",
      message: request.message ?? "The protected executor could not place this request.",
    };
  }
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
      state: "open_on_venue",
      label: "Open on venue",
      message: `${matchingPosition.market} ${matchingPosition.side} is open on Hyperliquid with ${formatSignedUsd(matchingPosition.unrealizedPnlUsd ?? "0")} live P/L.`,
    };
  }
  if (request.artifact?.orderId?.trim()) {
    return {
      state: "not_found",
      label: "Not found",
      message:
        "ClearSig has an exchange order ID for this request, but no matching Hyperliquid position is open now.",
    };
  }
  return {
    state: "submitted",
    label: "Submitted",
    message:
      "ClearSig submitted this request. Waiting for the next account snapshot to confirm whether it opened.",
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
