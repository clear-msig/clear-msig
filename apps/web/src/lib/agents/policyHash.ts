import { sha256, toHex } from "@/lib/msig/hash";
import type {
  AgentExecutionRecord,
  AgentSessionGrant,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

const enc = new TextEncoder();

export function computeAgentVaultPolicyHash(policy: AgentVaultPolicy): string {
  return stableHash({
    kind: "clearsig.agent.vault-policy",
    version: 1,
    walletName: policy.walletName,
    enabled: Boolean(policy.enabled),
    allowedVenues: sortedStrings(policy.allowedVenues),
    allowedMarkets: sortedStrings(policy.allowedMarkets.map(normalizeMarket)),
    maxNotionalUsd: normalizeDecimalText(policy.maxNotionalUsd),
    maxLeverage: normalizeNumber(policy.maxLeverage),
    requireStopLoss: Boolean(policy.requireStopLoss),
    requireTakeProfit: Boolean(policy.requireTakeProfit),
    maxOpenPositionsPerAgent: normalizeNumber(policy.maxOpenPositionsPerAgent),
    cooldownSeconds: normalizeNumber(policy.cooldownSeconds),
    maxSessionHours: normalizeNumber(policy.maxSessionHours),
    dailyLossCapUsd: normalizeDecimalText(policy.dailyLossCapUsd),
  });
}

export function bindAgentVaultPolicyHash(policy: AgentVaultPolicy): AgentVaultPolicy {
  if (policy.policyHash && hasEncryptedPolicyControls(policy)) {
    return {
      ...policy,
      policyHash: policy.policyHash,
    };
  }
  return {
    ...policy,
    policyHash: computeAgentVaultPolicyHash(policy),
  };
}

export function bindAgentSessionPolicyHash(
  session: AgentSessionGrant,
  policy: AgentVaultPolicy,
): AgentSessionGrant {
  return {
    ...session,
    policyHash: policy.policyHash ?? computeAgentVaultPolicyHash(policy),
  };
}

export function bindAgentProposalPolicyHash(
  proposal: AgentTradeProposal,
  policy: AgentVaultPolicy,
): AgentTradeProposal {
  return {
    ...proposal,
    policyHash: policy.policyHash ?? computeAgentVaultPolicyHash(policy),
  };
}

export function bindAgentExecutionPolicyHash(
  execution: AgentExecutionRecord,
  proposal: AgentTradeProposal | null | undefined,
): AgentExecutionRecord {
  return proposal?.policyHash
    ? { ...execution, policyHash: proposal.policyHash }
    : execution;
}

export function agentSessionPolicyBindingStatus(
  session: AgentSessionGrant,
  policy: AgentVaultPolicy,
): "current" | "missing" | "stale" {
  if (!session.policyHash || !policy.policyHash) return "missing";
  return session.policyHash === policy.policyHash ? "current" : "stale";
}

export function isAgentSessionCurrent(
  session: AgentSessionGrant,
  policy: AgentVaultPolicy,
  now = Date.now(),
): boolean {
  return (
    session.status === "active" &&
    session.expiresAt > now &&
    agentSessionPolicyBindingStatus(session, policy) === "current"
  );
}

function stableHash(value: unknown): string {
  return toHex(sha256(enc.encode(stableStringify(value))));
}

function stableStringify(value: unknown): string {
  if (value == null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function sortedStrings(values: readonly string[] | undefined): string[] {
  return [...(values ?? [])]
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function normalizeMarket(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeDecimalText(value: string | null | undefined): string {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function normalizeNumber(value: number | null | undefined): number {
  return Number.isFinite(value) ? Number(value) : 0;
}

function hasEncryptedPolicyControls(policy: AgentVaultPolicy): boolean {
  return Boolean(
    policy.encryptedAllowedVenues ||
      policy.encryptedAllowedMarkets ||
      policy.encryptedMaxNotionalUsd ||
      policy.encryptedMaxLeverage ||
      policy.encryptedRequireStopLoss ||
      policy.encryptedRequireTakeProfit ||
      policy.encryptedMaxOpenPositionsPerAgent ||
      policy.encryptedCooldownSeconds ||
      policy.encryptedMaxSessionHours ||
      policy.encryptedDailyLossCapUsd,
  );
}
