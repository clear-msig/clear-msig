import type { AgentAuditEvent } from "@/lib/agents/types";
import type { StoredShape } from "@/features/agents/local-state/repository";

export function newAgentEventId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `agent_event_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function appendEvent(
  shape: StoredShape,
  event: AgentAuditEvent,
): void {
  shape.eventsByWallet[event.walletName] ??= [];
  shape.eventsByWallet[event.walletName].push(event);
}
