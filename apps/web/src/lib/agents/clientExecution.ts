"use client";

import type { AgentTradeProposal } from "@/lib/agents/client";
import type { AgentServerExecutionReadiness } from "@/lib/agents/serverExecutionAdapters";
import type { AgentVenueReconciliationSummary } from "@/lib/agents/venueReconciliation";
import type {
  HyperliquidTestnetAccountProbe,
  HyperliquidTestnetAccountSnapshot,
  HyperliquidTestnetExecutorProbe,
  HyperliquidTestnetOrderArtifact,
  HyperliquidTestnetSettlementArtifact,
} from "@/lib/agents/serverHyperliquidTestnet";
import type { TrustedAgentSettlementInput } from "@/lib/agents/settlementClearSign";

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
    artifactHash?: string;
    settlementArtifact?: HyperliquidTestnetSettlementArtifact;
    settlementArtifactHash?: string;
    settlementProposalAddress?: string;
    settlementProposalStatus?: "created" | "approved" | "executed";
    settlementTxid?: string;
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

export interface AgentVenueSettlementResult {
  ok: boolean;
  message: string;
  status: number;
  settlement?: TrustedAgentSettlementInput;
  serverRequest?: AgentVenueRequestRecord;
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

export async function settleAgentVenueExecution({
  walletName,
  agentId,
  requestId,
}: {
  walletName: string;
  agentId: string;
  requestId: string;
}): Promise<AgentVenueSettlementResult> {
  const response = await fetch("/api/agent-settlement/hyperliquid_testnet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletName, agentId, requestId }),
  });
  const body = await response.json().catch(() => ({})) as {
    error?: unknown;
    settlement?: TrustedAgentSettlementInput;
    serverRequest?: AgentVenueRequestRecord;
    duplicate?: unknown;
  };
  return {
    ok: response.ok && Boolean(body.settlement),
    message: typeof body.error === "string"
      ? body.error
      : response.ok ? "Venue settlement artifact is ready." : response.statusText,
    status: response.status,
    settlement: body.settlement,
    serverRequest: body.serverRequest,
    duplicate: body.duplicate === true,
  };
}

export async function saveAgentVenueSettlementProposal({
  walletName,
  agentId,
  requestId,
  proposalAddress,
  status,
  txid,
}: {
  walletName: string;
  agentId: string;
  requestId: string;
  proposalAddress: string;
  status: "created" | "approved" | "executed";
  txid?: string;
}): Promise<void> {
  const response = await fetch("/api/agent-settlement/hyperliquid_testnet", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletName, agentId, requestId, proposalAddress, status, txid }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : "Settlement proposal state did not persist.");
  }
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
