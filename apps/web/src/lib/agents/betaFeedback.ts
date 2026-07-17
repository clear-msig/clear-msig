"use client";

export type AgentBetaFeedbackKind =
  | "bug"
  | "confusing"
  | "missing_feature"
  | "trust"
  | "performance"
  | "other";

export interface AgentBetaFeedbackInput {
  walletName: string;
  route: string;
  kind: AgentBetaFeedbackKind;
  message: string;
  contact?: string;
  agentId?: string;
  context?: Record<string, unknown>;
  now?: number;
}

export interface AgentBetaFeedbackItem {
  id: string;
  walletName: string;
  route: string;
  kind: AgentBetaFeedbackKind;
  message: string;
  contact?: string;
  agentId?: string;
  context?: Record<string, unknown>;
  createdAt: number;
  version: 1;
}

const STORAGE_KEY = "clear.agents.betaFeedback.v1";
const MAX_ITEMS = 200;

export function saveAgentBetaFeedback(
  input: AgentBetaFeedbackInput,
): AgentBetaFeedbackItem {
  const message = input.message.trim();
  if (!message) {
    throw new Error("Feedback message is required.");
  }
  const item: AgentBetaFeedbackItem = {
    id: newFeedbackId(),
    walletName: input.walletName,
    route: input.route,
    kind: input.kind,
    message,
    contact: clean(input.contact),
    agentId: clean(input.agentId),
    context: input.context,
    createdAt: input.now ?? Date.now(),
    version: 1,
  };
  const items = [item, ...listAllFeedback()].slice(0, MAX_ITEMS);
  writeAll(items);
  return item;
}

export function listAgentBetaFeedback(walletName: string): AgentBetaFeedbackItem[] {
  return listAllFeedback()
    .filter((item) => item.walletName === walletName)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export function clearAgentBetaFeedback(walletName: string): void {
  writeAll(listAllFeedback().filter((item) => item.walletName !== walletName));
}

function listAllFeedback(): AgentBetaFeedbackItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(isFeedbackItem).slice(0, MAX_ITEMS)
      : [];
  } catch {
    return [];
  }
}

function writeAll(items: AgentBetaFeedbackItem[]): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function isFeedbackItem(input: unknown): input is AgentBetaFeedbackItem {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const item = input as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.walletName === "string" &&
    typeof item.route === "string" &&
    isFeedbackKind(item.kind) &&
    typeof item.message === "string" &&
    typeof item.createdAt === "number" &&
    item.version === 1
  );
}

function isFeedbackKind(value: unknown): value is AgentBetaFeedbackKind {
  return (
    value === "bug" ||
    value === "confusing" ||
    value === "missing_feature" ||
    value === "trust" ||
    value === "performance" ||
    value === "other"
  );
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function newFeedbackId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_feedback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}
