import type { AgentSessionGrant } from "@/lib/agents/types";
import { AgentServerStateConflictError, type AgentServerWalletState } from "./stateTypes";
import { verifyAgentOwnerApprovalSignature } from "./ownerApprovalVerification";

export function sessionHasVerifiedGrant(
  state: AgentServerWalletState,
  session: AgentSessionGrant,
): boolean {
  return state.approvals.some((approval) =>
    approval.walletName === session.walletName &&
    approval.agentId === session.agentId &&
    approval.action === "grant_allowance" &&
    approval.targetType === "session" &&
    approval.targetId === session.id &&
    approval.approvalMethod === "wallet_signature" &&
    verifyAgentOwnerApprovalSignature(approval),
  );
}

export function validateSessionTransition(
  state: AgentServerWalletState,
  previous: AgentSessionGrant | undefined,
  incoming: AgentSessionGrant,
  now: number,
): void {
  if (previous && (previous.status === "revoked" || previous.status === "expired") &&
    incoming.status !== previous.status) {
    throw new AgentServerStateConflictError("Revoked and expired allowances are terminal. Create a new signed allowance.");
  }
  if (incoming.status !== "active") return;
  if (!Number.isSafeInteger(incoming.startsAt) || !Number.isSafeInteger(incoming.expiresAt) ||
    incoming.startsAt >= incoming.expiresAt || incoming.expiresAt <= now) {
    throw new AgentServerStateConflictError("Active allowance is expired or has invalid time bounds. Create a new signed allowance.");
  }
  if (!sessionHasVerifiedGrant(state, incoming)) {
    throw new AgentServerStateConflictError("Active allowances require a wallet-signed owner approval.");
  }
}
