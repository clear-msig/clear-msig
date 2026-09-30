import { backendApi } from "@/lib/api/endpoints";
import type { PendingRecurringExecution } from "@/lib/pro/treasury";
import { recurringAmountToRaw } from "@/features/treasury/domain/recurring";

export async function executeRecurringOperation(walletName: string, pending: PendingRecurringExecution) {
  const common = {
    scheduleId: pending.scheduleId,
    intervalSeconds: pending.intervalSeconds,
    firstExecutionAt: pending.firstExecutionAt,
    paymentCount: pending.paymentCount,
    status: pending.status,
  };
  if (pending.asset === "USDC") {
    const execute = pending.policyVersion === "CSP2"
      ? backendApi.executeTypedRecurringAssetSchedule
      : backendApi.executeTypedRecurringTokenSchedule;
    return execute(walletName, pending.proposalAddress, {
      ...common,
      mint: pending.mint!,
      sourceToken: pending.sourceToken!,
      destinationToken: pending.destinationToken!,
      recipientOwner: pending.recipientOwner!,
      amountTokens: recurringAmountToRaw(pending.amount, "USDC"),
    });
  }
  return backendApi.executeTypedRecurringSchedule(walletName, pending.proposalAddress, {
    ...common,
    recipient: pending.recipient,
    amountLamports: recurringAmountToRaw(pending.amount, "SOL"),
  });
}
