"use client";

import { readAgentState, writeAgentState } from "./repository";
import { currentAgentLocalStateScopeId } from "./scope";
import type { AgentProfile } from "@/lib/agents/types";

const LEGACY_KEY = "clear.agents.v1";

export function hasUnscopedAgentHistory(): boolean {
  if (typeof window === "undefined") return false;
  try { return Boolean(window.localStorage.getItem(LEGACY_KEY)); } catch { return false; }
}

/**
 * Explicit, conservative recovery: copy only inactive profile text. Old keys,
 * grants, signatures, executions and account assignments never become authority
 * in a newly selected subject/PDA namespace. Original bytes remain untouched.
 */
export function recoverLegacyAgentProfiles(input: {
  walletName: string;
  expectedScopeId: string;
  confirmedOwnership: boolean;
}): number {
  if (!input.confirmedOwnership || !input.expectedScopeId ||
    currentAgentLocalStateScopeId() !== input.expectedScopeId) {
    throw new Error("Confirm ownership in the current signed-in wallet before recovery.");
  }
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(LEGACY_KEY);
  if (!raw) return 0;
  if (raw.length > 8_000_000) throw new Error("Legacy history is too large for in-app recovery.");
  const legacy: unknown = JSON.parse(raw);
  if (!legacy || typeof legacy !== "object" || (legacy as { version?: unknown }).version !== 1) {
    throw new Error("Legacy history has an unsupported format.");
  }
  const rows = (legacy as { agentsByWallet?: Record<string, unknown> }).agentsByWallet?.[input.walletName];
  if (!Array.isArray(rows)) return 0;
  const state = readAgentState();
  const profiles = state.agentsByWallet[input.walletName] ?? [];
  let recovered = 0;
  for (const row of rows.slice(0, 250)) {
    if (!row || typeof row !== "object" || row.walletName !== input.walletName ||
      typeof row.id !== "string" || !row.id || typeof row.name !== "string" || !row.name.trim() ||
      profiles.some((profile) => profile.id === row.id)) continue;
    const profile: AgentProfile = {
      id: row.id, walletName: input.walletName, name: row.name.slice(0, 200), kind: "mock", status: "paused",
      description: typeof row.description === "string" ? row.description.slice(0, 2000) : undefined,
      createdAt: Number.isSafeInteger(row.createdAt) && row.createdAt > 0 ? row.createdAt : Date.now(),
      updatedAt: Date.now(), version: 1,
    };
    profiles.push(profile);
    recovered += 1;
  }
  state.agentsByWallet[input.walletName] = profiles;
  writeAgentState(state);
  return recovered;
}
