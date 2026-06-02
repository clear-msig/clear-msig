import {
  decryptPolicy,
  encryptPolicyBatch,
  type EncryptedPayload,
  type FheType,
} from "@/lib/encrypt/client";
import type {
  AgentProfile,
  AgentTradeProposal,
  AgentVaultPolicy,
} from "@/lib/agents/types";

const enc = new TextEncoder();
const dec = new TextDecoder();

function textBytes(value: unknown): Uint8Array {
  return enc.encode(value == null ? "" : String(value));
}

function jsonBytes(value: unknown): Uint8Array {
  return enc.encode(JSON.stringify(value));
}

async function decryptText(payload: EncryptedPayload | undefined): Promise<string | null> {
  if (!payload) return null;
  const bytes = await decryptPolicy(payload);
  const text = dec.decode(bytes);
  return text.length === 0 ? null : text;
}

async function decryptJson<T>(
  payload: EncryptedPayload | undefined,
): Promise<T | null> {
  const text = await decryptText(payload);
  if (!text) return null;
  return JSON.parse(text) as T;
}

export async function encryptAgentVaultPolicy(
  policy: AgentVaultPolicy,
): Promise<AgentVaultPolicy> {
  const encrypted = await encryptPolicyBatch([
    { plaintext: jsonBytes(policy.allowedVenues), fheType: "ebytes" as FheType },
    { plaintext: jsonBytes(policy.allowedMarkets), fheType: "ebytes" as FheType },
    { plaintext: textBytes(policy.maxNotionalUsd), fheType: "ebytes" as FheType },
    { plaintext: textBytes(policy.maxLeverage), fheType: "euint8" as FheType },
    { plaintext: textBytes(policy.requireStopLoss ? 1 : 0), fheType: "ebool" as FheType },
    { plaintext: textBytes(policy.requireTakeProfit ? 1 : 0), fheType: "ebool" as FheType },
    { plaintext: textBytes(policy.maxOpenPositionsPerAgent), fheType: "euint8" as FheType },
    { plaintext: textBytes(policy.cooldownSeconds), fheType: "euint32" as FheType },
    { plaintext: textBytes(policy.maxSessionHours), fheType: "euint16" as FheType },
    { plaintext: textBytes(policy.dailyLossCapUsd), fheType: "ebytes" as FheType },
  ]);

  return {
    ...policy,
    allowedVenues: [],
    encryptedAllowedVenues: encrypted[0],
    allowedMarkets: [],
    encryptedAllowedMarkets: encrypted[1],
    maxNotionalUsd: "",
    encryptedMaxNotionalUsd: encrypted[2],
    maxLeverage: 0,
    encryptedMaxLeverage: encrypted[3],
    requireStopLoss: false,
    encryptedRequireStopLoss: encrypted[4],
    requireTakeProfit: false,
    encryptedRequireTakeProfit: encrypted[5],
    maxOpenPositionsPerAgent: 0,
    encryptedMaxOpenPositionsPerAgent: encrypted[6],
    cooldownSeconds: 0,
    encryptedCooldownSeconds: encrypted[7],
    maxSessionHours: 0,
    encryptedMaxSessionHours: encrypted[8],
    dailyLossCapUsd: "",
    encryptedDailyLossCapUsd: encrypted[9],
  };
}

export async function decryptAgentVaultPolicy(
  policy: AgentVaultPolicy,
): Promise<AgentVaultPolicy> {
  return {
    ...policy,
    allowedVenues:
      (await decryptJson<AgentVaultPolicy["allowedVenues"]>(
        policy.encryptedAllowedVenues,
      )) ?? policy.allowedVenues,
    allowedMarkets:
      (await decryptJson<string[]>(policy.encryptedAllowedMarkets)) ??
      policy.allowedMarkets,
    maxNotionalUsd:
      (await decryptText(policy.encryptedMaxNotionalUsd)) ?? policy.maxNotionalUsd,
    maxLeverage:
      parseNumber(await decryptText(policy.encryptedMaxLeverage)) ?? policy.maxLeverage,
    requireStopLoss:
      parseBool(await decryptText(policy.encryptedRequireStopLoss)) ??
      policy.requireStopLoss,
    requireTakeProfit:
      parseBool(await decryptText(policy.encryptedRequireTakeProfit)) ??
      policy.requireTakeProfit,
    maxOpenPositionsPerAgent:
      parseNumber(await decryptText(policy.encryptedMaxOpenPositionsPerAgent)) ??
      policy.maxOpenPositionsPerAgent,
    cooldownSeconds:
      parseNumber(await decryptText(policy.encryptedCooldownSeconds)) ??
      policy.cooldownSeconds,
    maxSessionHours:
      parseNumber(await decryptText(policy.encryptedMaxSessionHours)) ??
      policy.maxSessionHours,
    dailyLossCapUsd:
      (await decryptText(policy.encryptedDailyLossCapUsd)) ?? policy.dailyLossCapUsd,
  };
}

export async function encryptAgentTradeProposal(
  proposal: AgentTradeProposal,
): Promise<AgentTradeProposal> {
  if (!proposal.thesis) return proposal;
  const encrypted = await encryptPolicyBatch([
    { plaintext: textBytes(proposal.thesis), fheType: "ebytes" as FheType },
  ]);
  return {
    ...proposal,
    thesis: undefined,
    encryptedThesis: encrypted[0],
  };
}

export async function decryptAgentTradeProposal(
  proposal: AgentTradeProposal,
): Promise<AgentTradeProposal> {
  const thesis = await decryptText(proposal.encryptedThesis);
  return thesis == null ? proposal : { ...proposal, thesis };
}

export async function encryptAgentProfile(profile: AgentProfile): Promise<AgentProfile> {
  if (!profile.description) return profile;
  const encrypted = await encryptPolicyBatch([
    { plaintext: textBytes(profile.description), fheType: "ebytes" as FheType },
  ]);
  return {
    ...profile,
    description: undefined,
    encryptedDescription: encrypted[0],
  };
}

export async function decryptAgentProfile(profile: AgentProfile): Promise<AgentProfile> {
  const description = await decryptText(profile.encryptedDescription);
  return description == null ? profile : { ...profile, description };
}

function parseNumber(value: string | null): number | null {
  if (value == null || value.length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseBool(value: string | null): boolean | null {
  if (value == null || value.length === 0) return null;
  return value === "1" || value === "true";
}
