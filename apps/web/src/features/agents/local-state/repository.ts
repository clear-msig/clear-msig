"use client";

import { AGENT_LOCAL_SCOPE_EVENT, currentAgentLocalStateScopeToken, readScopedAgentStorage, writeScopedAgentStorage } from "./scope";

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
const snapshotScopes = new WeakMap<StoredShape, object | null>();

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
  snapshotScopes.set(empty, currentAgentLocalStateScopeToken());
  if (typeof window === "undefined") return empty;
  try {
    const raw = readScopedAgentStorage(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    if ((parsed as StoredShape).version !== 1) return empty;
    const state: StoredShape = { ...empty, ...(parsed as StoredShape), version: 1 };
    snapshotScopes.set(state, currentAgentLocalStateScopeToken());
    return state;
  } catch {
    return empty;
  }
}

export function writeAgentState(shape: StoredShape): void {
  if (typeof window === "undefined") return;
  const expectedScope = snapshotScopes.get(shape);
  if (!expectedScope || expectedScope !== currentAgentLocalStateScopeToken()) {
    throw new Error("Agent account changed. Reopen this action in the current account.");
  }
  try {
    writeScopedAgentStorage(STORAGE_KEY, JSON.stringify(shape));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage quota and private-mode failures must not break the app.
  }
}

export function subscribeAgents(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener(AGENT_LOCAL_SCOPE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener(AGENT_LOCAL_SCOPE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}
