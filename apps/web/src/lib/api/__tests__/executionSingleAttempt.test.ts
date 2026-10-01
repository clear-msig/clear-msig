import { beforeEach, describe, expect, it, vi } from "vitest";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/client", () => ({ apiRequest: request, BackendApiError: class extends Error {} }));
vi.mock("@/lib/hooks/useSignWithWallet", () => ({ WalletSignError: class extends Error {} }));
import { backendApi } from "@/lib/api/endpoints";
const names = [
  "executeTypedEscrowRelease", "executeTypedEscrowReturn", "executeTypedSplEscrowRelease", "executeTypedSplEscrowReturn",
  "executeTypedCrossChainEscrowRelease", "executeTypedCrossChainEscrowReturn", "executeTypedPrivateEscrowRelease", "executeTypedPrivateEscrowReturn",
  "executeTypedRecurringSchedule", "executeTypedRecurringTokenSchedule", "executeTypedRecurringAssetSchedule",
  "executeRecurringPayment", "executeRecurringTokenPayment", "executeRecurringAssetPayment",
  "executeTypedWalletPolicyUpdate", "executeTypedAssetPolicyUpdate", "executeTypedAgentTradeApproval", "executeTypedAgentSessionGrant", "executeTypedAgentRiskPolicy", "executeTypedAgentTradeSettlement", "executeTypedChainSend",
] as const;
beforeEach(() => { request.mockReset(); request.mockRejectedValue(new Error("node is behind")); });
describe("reviewed execution endpoints do not automatically repeat uncertain writes", () => {
  it.each(names)("%s submits once when retry is disabled", async (name) => {
    const call = backendApi[name] as (...args: unknown[]) => Promise<unknown>;
    const args = name.startsWith("executeRecurring") ? ["wallet", {}, { retry: false }] : ["wallet", "proposal", {}, { retry: false }];
    await expect(call(...args)).rejects.toThrow("node is behind");
    expect(request).toHaveBeenCalledTimes(1);
  });
});
