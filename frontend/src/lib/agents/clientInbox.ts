"use client";

import {
  getAgentConnectionKit,
  updateAgentConnectionSettings,
} from "@/lib/agents/storage";
import type {
  AgentConnectionKit,
  AgentPolicyEvaluation,
  AgentSignalInboxItem,
  AgentTradeProposal,
} from "@/lib/agents/types";

export interface AgentInboxSummary {
  count: number;
  storage: "redis" | "memory" | "unknown";
  status: "ready" | "unavailable";
  updatedAt: number;
}

export interface AgentInboxImportResponse {
  imported: Array<{
    item: AgentSignalInboxItem;
    proposal: AgentTradeProposal;
    evaluation: AgentPolicyEvaluation | null;
    duplicate: boolean;
  }>;
  skipped: Array<{
    item: AgentSignalInboxItem;
    reason: string;
    evaluation?: AgentPolicyEvaluation | null;
  }>;
  removed: number;
  storage: "redis" | "memory" | "unknown";
}

export async function loadAgentInboxSummary(
  walletName: string,
  agentId: string,
): Promise<AgentInboxSummary> {
  const kit = getAgentConnectionKit(walletName, agentId);
  const path = apiPath(walletName, agentId);
  await registerInbox(
    path,
    kit.signalKey,
    kit.managementKey,
    kit.autoImportSessionSignals,
  );
  const response = await fetch(path, {
    method: "GET",
    headers: { "x-clearsig-management-key": kit.managementKey },
  });
  if (!response.ok) {
    throw new Error(await errorText(response));
  }
  const body = (await response.json()) as {
    signals?: AgentSignalInboxItem[];
    storage?: "redis" | "memory";
  };
  return {
    count: Array.isArray(body.signals) ? body.signals.length : 0,
    storage: body.storage ?? "unknown",
    status: "ready",
    updatedAt: Date.now(),
  };
}

export async function importAgentInboxSignalsOnServer({
  walletName,
  agentId,
  managementKey,
  ids,
  allowedOnly = false,
}: {
  walletName: string;
  agentId: string;
  managementKey: string;
  ids: string[];
  allowedOnly?: boolean;
}): Promise<AgentInboxImportResponse> {
  const response = await fetch(apiPath(walletName, agentId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-clearsig-management-key": managementKey,
    },
    body: JSON.stringify({
      action: "import",
      ids,
      allowedOnly,
    }),
  });
  if (!response.ok) {
    throw new Error(await errorText(response));
  }
  const body = (await response.json()) as Partial<AgentInboxImportResponse> & {
    storage?: "redis" | "memory";
  };
  return {
    imported: Array.isArray(body.imported) ? body.imported : [],
    skipped: Array.isArray(body.skipped) ? body.skipped : [],
    removed: typeof body.removed === "number" ? body.removed : 0,
    storage: body.storage ?? "unknown",
  };
}

export async function setAgentAutomaticTrading(
  walletName: string,
  agentId: string,
  enabled: boolean,
): Promise<AgentConnectionKit> {
  const kit = getAgentConnectionKit(walletName, agentId);
  await registerInbox(
    apiPath(walletName, agentId),
    kit.signalKey,
    kit.managementKey,
    enabled,
  );
  const updated = updateAgentConnectionSettings(walletName, agentId, {
    autoImportSessionSignals: enabled,
  });
  if (!updated) {
    throw new Error("Trader connection not found.");
  }
  return updated;
}

async function registerInbox(
  path: string,
  signalKey: string,
  managementKey: string,
  autoImportSessionSignals: boolean,
): Promise<void> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "register",
      signalKey,
      managementKey,
      autoImportSessionSignals,
    }),
  });
  if (!response.ok) {
    throw new Error(await errorText(response));
  }
}

function apiPath(walletName: string, agentId: string): string {
  return `/api/agent-signals/${encodeURIComponent(walletName)}/${encodeURIComponent(agentId)}`;
}

async function errorText(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return typeof body.error === "string" ? body.error : response.statusText;
  } catch {
    return response.statusText;
  }
}
