"use client";

import type {
  AgentAuditEvent,
  AgentConnectionKit,
  AgentExecutionRecord,
  AgentOwnerApproval,
  AgentProfile,
  AgentScorecard,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

const STORAGE_KEY = "clear.agents.v1";
const CHANGE_EVENT = "clear:agents-changed";

export interface StoredShape {
  agentsByWallet: Record<string, AgentProfile[]>;
  policiesByWallet: Record<string, AgentVaultPolicy>;
  proposalsByWallet: Record<string, AgentTradeProposal[]>;
  sessionsByWallet: Record<string, AgentSessionGrant[]>;
  executionsByWallet: Record<string, AgentExecutionRecord[]>;
  eventsByWallet: Record<string, AgentAuditEvent[]>;
  scorecardsByWallet: Record<string, Record<string, AgentScorecard>>;
  connectionsByWallet: Record<string, Record<string, AgentConnectionKit>>;
  approvalsByWallet: Record<string, AgentOwnerApproval[]>;
  version: 1;
}

export function emptyStoredShape(): StoredShape {
  return {
    agentsByWallet: {},
    policiesByWallet: {},
    proposalsByWallet: {},
    sessionsByWallet: {},
    executionsByWallet: {},
    eventsByWallet: {},
    scorecardsByWallet: {},
    connectionsByWallet: {},
    approvalsByWallet: {},
    version: 1,
  };
}

export function readAgentState(): StoredShape {
  const empty = emptyStoredShape();
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    if ((parsed as StoredShape).version !== 1) return empty;
    return { ...empty, ...(parsed as StoredShape), version: 1 };
  } catch {
    return empty;
  }
}

export function writeAgentState(shape: StoredShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage quota and private-mode failures must not break the app.
  }
}

export function subscribeAgents(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
