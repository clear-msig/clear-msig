import type { PendingRecurringExecution, ProSchedule } from "@/lib/pro/treasury";
import { recurringAmountToRaw } from "./recurring";

const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;

// Persisted convenience state is untrusted. Refuse legacy or malformed retry
// records rather than inferring an activation from a possibly revoked proposal.
export function requireRecurringExecution(row: ProSchedule): PendingRecurringExecution {
  const pending = row.pendingExecution;
  if (!pending || pending.version !== 1) {
    throw new Error("This request has no verified retry details. Open its proposal in Activity to review it; do not recreate it until its status is known.");
  }
  if (pending.scheduleId !== row.id || pending.proposalAddress !== row.proposalAddress
    || !nonempty(pending.proposalAddress) || !nonempty(pending.recipient)
    || !nonempty(pending.amount) || (pending.status !== 1 && pending.status !== 2)
    || (pending.asset !== "SOL" && pending.asset !== "USDC")
    || (pending.policyVersion !== "CSP1" && pending.policyVersion !== "CSP2")
    || !positiveInteger(pending.intervalSeconds) || pending.intervalSeconds > 0xffffffff
    || !positiveInteger(pending.firstExecutionAt)
    || !positiveInteger(pending.paymentCount) || pending.paymentCount > 1_000) {
    throw new Error("The saved retry details are incomplete or inconsistent. Review the proposal in Activity.");
  }
  recurringAmountToRaw(pending.amount, pending.asset);
  if (pending.asset === "USDC" && (!nonempty(pending.mint) || !nonempty(pending.sourceToken)
    || !nonempty(pending.destinationToken) || !nonempty(pending.recipientOwner))) {
    throw new Error("This USDC request is missing its bound token accounts. Review the proposal in Activity.");
  }
  return { ...pending };
}

export function recurringExecutionApplied(
  pending: PendingRecurringExecution,
  state: { status: "active" | "revoked" | "complete" } | null | undefined,
): boolean {
  return pending.status === 2
    ? state?.status === "revoked"
    : state?.status === "active" || state?.status === "complete";
}
