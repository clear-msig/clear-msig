"use client";

// Per-wallet policy-rule storage. Rules persist locally under a
// stable per-wallet key — when on-chain enforcement lands (Encrypt's
// `#[encrypt_fn]` handlers), this same shape moves to chain-stored
// ciphertext refs without changing call sites.
//
// Storage shape: map of wallet name → ordered list of rules. A
// custom event ("clear:policies-changed") fires on every write so
// open consumers (the policies list + the send-page tripwire) can
// re-render without a navigate.

import type { PolicyRule } from "@/lib/policies/types";

const STORAGE_KEY = "clear.policies.v1";
const CHANGE_EVENT = "clear:policies-changed";

interface StoredShape {
  // Map of walletName → rules. Keyed by name (with the #XXXXXX
  // creator suffix) because that's the stable identifier the rest
  // of the app keys off. PDAs would also work but require a fetch.
  byWallet: Record<string, PolicyRule[]>;
  version: 1;
}

function readAll(): StoredShape {
  const empty: StoredShape = { byWallet: {}, version: 1 };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return empty;
    if ((parsed as StoredShape).version !== 1) return empty;
    if (!parsed.byWallet || typeof parsed.byWallet !== "object") return empty;
    return parsed as StoredShape;
  } catch {
    return empty;
  }
}

function writeAll(shape: StoredShape): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(shape));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* quota / private mode — silently noop */
  }
}

/// List policy rules for a single wallet, sorted by descending
/// priority then ascending createdAt (stable order on equal
/// priorities).
export function listPolicies(walletName: string): PolicyRule[] {
  const all = readAll().byWallet[walletName] ?? [];
  return [...all].sort((a, b) => {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.createdAt - b.createdAt;
  });
}

/// Look up a single rule by id within a wallet's list.
export function findPolicy(walletName: string, id: string): PolicyRule | null {
  return listPolicies(walletName).find((r) => r.id === id) ?? null;
}

/// Add a new rule. Caller is responsible for setting id, createdAt,
/// updatedAt, version. Returns the saved rule.
export function savePolicy(rule: PolicyRule): PolicyRule {
  const shape = readAll();
  const list = shape.byWallet[rule.walletName] ?? [];
  const existingIdx = list.findIndex((r) => r.id === rule.id);
  if (existingIdx >= 0) {
    list[existingIdx] = rule;
  } else {
    list.push(rule);
  }
  shape.byWallet[rule.walletName] = list;
  writeAll(shape);
  return rule;
}

export function removePolicy(walletName: string, id: string): void {
  const shape = readAll();
  const list = shape.byWallet[walletName] ?? [];
  shape.byWallet[walletName] = list.filter((r) => r.id !== id);
  writeAll(shape);
}

/// Subscribe to policy-list changes. Fires for our own writes (via
/// the dispatchEvent above) AND for cross-tab writes (via the
/// native `storage` event).
export function subscribePolicies(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => callback();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

/// Generate a fresh rule id. Uses crypto.randomUUID when available;
/// falls back to a timestamp-suffixed random string for older
/// browsers where the Web Crypto API may not be polyfilled.
export function newRuleId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `r_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
