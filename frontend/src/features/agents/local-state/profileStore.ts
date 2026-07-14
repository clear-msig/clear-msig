"use client";

import { blankAgentScorecard } from "@/features/agents/domain/scorecardState";
import { readAgentState as readAll, writeAgentState as writeAll } from "@/features/agents/local-state/repository";
import { appendEvent, newAgentEventId } from "@/features/agents/local-state/stateSupport";
import type { AgentConnectionKit, AgentModerationStatus, AgentProfile } from "@/lib/agents/types";

export function listAgents(walletName: string): AgentProfile[] {
  return [...(readAll().agentsByWallet[walletName] ?? [])].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
}

export function findAgent(walletName: string, id: string): AgentProfile | null {
  return listAgents(walletName).find((agent) => agent.id === id) ?? null;
}

export function saveAgent(agent: AgentProfile): AgentProfile {
  const shape = readAll();
  const list = shape.agentsByWallet[agent.walletName] ?? [];
  const idx = list.findIndex((existing) => existing.id === agent.id);
  if (idx >= 0) list[idx] = agent;
  else list.push(agent);
  shape.agentsByWallet[agent.walletName] = list;
  shape.scorecardsByWallet[agent.walletName] ??= {};
  shape.scorecardsByWallet[agent.walletName][agent.id] ??=
    blankAgentScorecard(agent, Date.now());
  writeAll(shape);
  return agent;
}

export function getAgentConnectionKit(
  walletName: string,
  agentId: string,
): AgentConnectionKit {
  const shape = readAll();
  shape.connectionsByWallet[walletName] ??= {};
  const existing = shape.connectionsByWallet[walletName][agentId];
  if (existing) {
    if (!existing.managementKey || existing.autoImportSessionSignals == null) {
      const updated = {
        ...existing,
        managementKey: existing.managementKey ?? newConnectionManagementKey(),
        autoImportSessionSignals: existing.autoImportSessionSignals ?? false,
      };
      shape.connectionsByWallet[walletName][agentId] = updated;
      writeAll(shape);
      return updated;
    }
    return existing;
  }
  const now = Date.now();
  const kit: AgentConnectionKit = {
    walletName,
    agentId,
    signalKey: newSignalKey(),
    managementKey: newConnectionManagementKey(),
    autoImportSessionSignals: false,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  shape.connectionsByWallet[walletName][agentId] = kit;
  writeAll(shape);
  return kit;
}

export function listAgentConnectionKits(walletName: string): AgentConnectionKit[] {
  return Object.values(readAll().connectionsByWallet[walletName] ?? {}).sort(
    (a, b) => b.updatedAt - a.updatedAt,
  );
}

export function rotateAgentSignalKey(
  walletName: string,
  agentId: string,
): AgentConnectionKit | null {
  const shape = readAll();
  const agent = (shape.agentsByWallet[walletName] ?? []).find(
    (item) => item.id === agentId,
  );
  if (!agent) return null;
  const now = Date.now();
  const kit: AgentConnectionKit = {
    walletName,
    agentId,
    signalKey: newSignalKey(),
    managementKey:
      shape.connectionsByWallet[walletName]?.[agentId]?.managementKey ??
      newConnectionManagementKey(),
    autoImportSessionSignals:
      shape.connectionsByWallet[walletName]?.[agentId]?.autoImportSessionSignals ??
      false,
    createdAt:
      shape.connectionsByWallet[walletName]?.[agentId]?.createdAt ?? now,
    updatedAt: now,
    version: 1,
  };
  shape.connectionsByWallet[walletName] ??= {};
  shape.connectionsByWallet[walletName][agentId] = kit;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId,
    kind: "connection_key_rotated",
    message: `${agent.name} signal key rotated.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return kit;
}

export function updateAgentConnectionSettings(
  walletName: string,
  agentId: string,
  settings: Pick<AgentConnectionKit, "autoImportSessionSignals">,
): AgentConnectionKit | null {
  const shape = readAll();
  const existing = shape.connectionsByWallet[walletName]?.[agentId];
  if (!existing) return null;
  const updated: AgentConnectionKit = {
    ...existing,
    managementKey: existing.managementKey ?? newConnectionManagementKey(),
    autoImportSessionSignals: settings.autoImportSessionSignals,
    updatedAt: Date.now(),
  };
  shape.connectionsByWallet[walletName] ??= {};
  shape.connectionsByWallet[walletName][agentId] = updated;
  writeAll(shape);
  return updated;
}

export function updateAgentStatus(
  walletName: string,
  id: string,
  status: AgentProfile["status"],
): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent) return null;
  const now = Date.now();
  const updated: AgentProfile = { ...agent, status, updatedAt: now };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  if (status !== "active") {
    shape.sessionsByWallet[walletName] = (shape.sessionsByWallet[walletName] ?? []).map(
      (session) =>
        session.agentId === id && session.status === "active"
          ? { ...session, status: "revoked", updatedAt: now }
          : session,
    );
  }
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_status_changed",
    message: `${agent.name} ${agentStatusEventLabel(status)}.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function publishAgentProfile(
  walletName: string,
  id: string,
  publicSummary?: string,
): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent) return null;
  const now = Date.now();
  const slug =
    agent.publishing?.slug ??
    `${slugPart(agent.name || "agent")}-${slugPart(agent.id)}`;
  const updated: AgentProfile = {
    ...agent,
    publishing: {
      status: "published",
      slug,
      publicSummary:
        publicSummary?.trim() ||
        agent.publishing?.publicSummary ||
        agent.description?.trim() ||
        `${agent.name} trading profile`,
      visibleMetrics: [
        "score",
        "realized_pnl",
        "closed_trades",
        "open_trades",
        "win_rate",
        "safety_stops",
        "allocation_tier",
      ],
      moderation: agent.publishing?.moderation ?? {
        status: "pending_review",
        reason: "Newly published profiles need marketplace review before broad discovery.",
        updatedAt: now,
        version: 1,
      },
      publishedAt: agent.publishing?.publishedAt ?? now,
      updatedAt: now,
      version: 1,
    },
    updatedAt: now,
  };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_profile_published",
    message: `${agent.name} publishing profile turned on.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function moderateAgentPublishingProfile({
  walletName,
  id,
  status,
  reason,
  reviewedBy = "ClearSig admin",
}: {
  walletName: string;
  id: string;
  status: AgentModerationStatus;
  reason?: string;
  reviewedBy?: string;
}): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent?.publishing) return null;
  const now = Date.now();
  const updated: AgentProfile = {
    ...agent,
    publishing: {
      ...agent.publishing,
      moderation: {
        status,
        reason: reason?.trim() || moderationReason(status),
        reviewedBy,
        reviewedAt: now,
        updatedAt: now,
        version: 1,
      },
      updatedAt: now,
    },
    updatedAt: now,
  };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_profile_moderated",
    message: `${agent.name} marketplace review set to ${moderationLabel(status)}.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

export function unpublishAgentProfile(
  walletName: string,
  id: string,
): AgentProfile | null {
  const shape = readAll();
  const list = shape.agentsByWallet[walletName] ?? [];
  const idx = list.findIndex((agent) => agent.id === id);
  if (idx < 0) return null;
  const agent = list[idx];
  if (!agent) return null;
  const now = Date.now();
  const updated: AgentProfile = {
    ...agent,
    publishing: {
      status: "draft",
      slug:
        agent.publishing?.slug ??
        `${slugPart(agent.name || "agent")}-${slugPart(agent.id)}`,
      publicSummary:
        agent.publishing?.publicSummary ||
        agent.description?.trim() ||
        `${agent.name} trading profile`,
      visibleMetrics:
        agent.publishing?.visibleMetrics ?? [
          "score",
          "realized_pnl",
          "closed_trades",
          "open_trades",
          "win_rate",
          "safety_stops",
          "allocation_tier",
        ],
      moderation: agent.publishing?.moderation,
      publishedAt: agent.publishing?.publishedAt,
      updatedAt: now,
      version: 1,
    },
    updatedAt: now,
  };
  list[idx] = updated;
  shape.agentsByWallet[walletName] = list;
  appendEvent(shape, {
    id: newAgentEventId(),
    walletName,
    agentId: id,
    kind: "agent_profile_unpublished",
    message: `${agent.name} publishing profile turned off.`,
    createdAt: now,
    version: 1,
  });
  writeAll(shape);
  return updated;
}

function moderationReason(status: AgentModerationStatus): string {
  switch (status) {
    case "pending_review":
      return "Profile is waiting for marketplace review.";
    case "approved":
      return "Profile passed marketplace review.";
    case "paused":
      return "Profile is paused while ClearSig reviews recent behavior.";
    case "delisted":
      return "Profile is hidden from marketplace discovery.";
  }
}

function moderationLabel(status: AgentModerationStatus): string {
  return status.replace("_", " ");
}

function newSignalKey(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return `cs_sig_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `cs_sig_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function newConnectionManagementKey(): string {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    return `cs_mgmt_${Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `cs_mgmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

function agentStatusEventLabel(status: AgentProfile["status"]): string {
  return status === "active" ? "resumed" : status;
}

function slugPart(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "agent";
}
