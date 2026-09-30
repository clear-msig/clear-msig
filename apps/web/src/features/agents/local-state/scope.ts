"use client";

import { PublicKey } from "@solana/web3.js";
import { sha256, toHex } from "@/lib/msig/hash";

export interface AgentLocalStateScope {
  /** SDK session subject: local privacy namespace only, never server authority. */
  sessionSubject: string;
  walletPda: string;
  chainNamespace: string;
}

export const AGENT_LOCAL_SCOPE_EVENT = "clear:agents-scope-changed";
let active: { id: string; owner: object } | null = null;

export function agentLocalStateScopeId(scope: AgentLocalStateScope): string {
  if (!scope.sessionSubject.trim() || scope.sessionSubject.length > 512 ||
    new PublicKey(scope.walletPda).toBase58() !== scope.walletPda ||
    new PublicKey(scope.chainNamespace).toBase58() !== scope.chainNamespace) {
    throw new Error("Signed-in subject and canonical wallet identity are required for local agent state.");
  }
  return toHex(sha256(new TextEncoder().encode(JSON.stringify([
    "clearsig.agent.local-scope.v2", scope.sessionSubject, scope.walletPda,
    scope.chainNamespace,
    process.env.NEXT_PUBLIC_CLEAR_WALLET_PROGRAM_ID ?? "53aZBmukjX5sYxbrYVRDd2DWzsRWVmvVFPY6PcyomR5v",
  ]))));
}

export function activateAgentLocalStateScope(scope: AgentLocalStateScope): () => void {
  const owner = {};
  active = { id: agentLocalStateScopeId(scope), owner };
  notifyScopeChange();
  return () => {
    // A stale component cleanup must not clear a newer account's scope.
    if (active?.owner === owner) clearAgentLocalStateScope();
  };
}

export function clearAgentLocalStateScope(): void {
  active = null;
  notifyScopeChange();
}

export function currentAgentLocalStateScopeId(): string | null {
  return active?.id ?? null;
}

/** Distinguishes separate login/mount lifetimes, including the same account. */
export function currentAgentLocalStateScopeToken(): object | null {
  return active?.owner ?? null;
}

export function scopedAgentStorageKey(legacyKey: string): string | null {
  return active ? `${legacyKey.replace(/\.v1$/, "")}.v2:${active.id}` : null;
}

export function readScopedAgentStorage(legacyKey: string): string | null {
  const key = scopedAgentStorageKey(legacyKey);
  if (!key || typeof window === "undefined") return null;
  return window.localStorage.getItem(key);
}

export function writeScopedAgentStorage(legacyKey: string, value: string, expectedScope = currentAgentLocalStateScopeId()): void {
  const key = scopedAgentStorageKey(legacyKey);
  if (!key || !expectedScope || expectedScope !== currentAgentLocalStateScopeId()) {
    throw new Error("Agent account changed. Reopen this action in the current account.");
  }
  if (typeof window !== "undefined") window.localStorage.setItem(key, value);
}

function notifyScopeChange(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AGENT_LOCAL_SCOPE_EVENT));
}
