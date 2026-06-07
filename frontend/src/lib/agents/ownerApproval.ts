import type {
  AgentOwnerActionKind,
  AgentOwnerApproval,
  AgentOwnerApprovalDetail,
} from "@/lib/agents/types";

export interface AgentOwnerApprovalInput {
  walletName: string;
  agentId?: string;
  action: AgentOwnerActionKind;
  summary: string;
  details?: AgentOwnerApprovalDetail[];
  targetType?: AgentOwnerApproval["targetType"];
  targetId?: string;
  approvedBy?: string | null;
  signature?: string | null;
  now?: number;
}

export async function createBrowserOwnerApproval(
  input: AgentOwnerApprovalInput,
): Promise<AgentOwnerApproval> {
  const createdAt = input.now ?? Date.now();
  const details = (input.details ?? []).map((detail) => ({
    label: detail.label.trim(),
    value: detail.value.trim(),
  }));
  const hashPayload = {
    walletName: input.walletName,
    agentId: input.agentId ?? null,
    action: input.action,
    summary: input.summary.trim(),
    details,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    approvalMethod: input.signature ? "wallet_signature" : "browser_confirm",
    approvedBy: input.approvedBy ?? null,
    signature: input.signature ?? null,
    createdAt,
    version: 1,
  };
  return {
    id: newOwnerApprovalId(),
    walletName: input.walletName,
    agentId: input.agentId,
    action: input.action,
    summary: input.summary.trim(),
    details,
    targetType: input.targetType,
    targetId: input.targetId,
    approvalMethod: input.signature ? "wallet_signature" : "browser_confirm",
    approvedBy: input.approvedBy ?? null,
    signature: input.signature ?? null,
    approvalHash: await sha256Hex(stableJson(hashPayload)),
    createdAt,
    version: 1,
  };
}

export function ownerApprovalSignableText(
  input: AgentOwnerApprovalInput,
  createdAt: number,
): string {
  const details = (input.details ?? [])
    .filter((detail) => detail.label.trim() && detail.value.trim())
    .slice(0, 8)
    .map((detail) => `${detail.label.trim()}: ${detail.value.trim()}`);
  return [
    "ClearSig Agent Trading Approval",
    "",
    `Action: ${input.summary.trim()}`,
    `Wallet: ${input.walletName}`,
    input.agentId ? `Trader ID: ${input.agentId}` : null,
    input.targetType && input.targetId
      ? `Target: ${input.targetType}/${input.targetId}`
      : null,
    `Time: ${new Date(createdAt).toISOString()}`,
    "",
    ...details,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

export function ownerApprovalConfirmText(input: {
  summary: string;
  details?: AgentOwnerApprovalDetail[];
}): string {
  const rows = (input.details ?? [])
    .filter((detail) => detail.label.trim() && detail.value.trim())
    .slice(0, 6)
    .map((detail) => `${detail.label}: ${detail.value}`);
  return [
    input.summary,
    "",
    ...rows,
    "",
    "Approve this action?",
  ].join("\n");
}

function newOwnerApprovalId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_owner_approval_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(new Uint8Array(digest));
  }
  return fallbackHash(value);
}

function stableJson(input: unknown): string {
  if (input == null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(stableJson).join(",")}]`;
  const record = input as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function fallbackHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
