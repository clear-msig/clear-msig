import { beforeEach, describe, expect, it, vi } from "vitest";

import { backendApi } from "@/lib/api/endpoints";
import { walletExistsAfterCreateFailure } from "@/features/wallet/ui/create/CreateWalletOptions";

vi.mock("@/lib/api/endpoints", () => ({
  backendApi: {
    showWallet: vi.fn(),
  },
}));

describe("wallet creation recovery", () => {
  beforeEach(() => {
    vi.mocked(backendApi.showWallet).mockReset();
  });

  it("recovers a landed wallet after a non-timeout create error", async () => {
    vi.mocked(backendApi.showWallet).mockResolvedValue({ wallet: "wallet-pda" });

    await expect(
      walletExistsAfterCreateFailure(
        "Jerry's Sch Feed Funds#abc123",
        new Error("execution failed"),
      ),
    ).resolves.toBe(true);
    expect(backendApi.showWallet).toHaveBeenCalledOnce();
  });

  it("does not hide a create error when no wallet landed", async () => {
    vi.mocked(backendApi.showWallet).mockRejectedValue(new Error("not found"));

    await expect(
      walletExistsAfterCreateFailure("Missing#abc123", new Error("execution failed")),
    ).resolves.toBe(false);
  });
});
