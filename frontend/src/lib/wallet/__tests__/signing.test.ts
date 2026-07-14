import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WalletSignatureTimeoutError,
  withWalletSignatureTimeout,
} from "@/lib/wallet/signing";

describe("withWalletSignatureTimeout", () => {
  afterEach(() => vi.useRealTimers());

  it("returns a wallet signature that resolves before the deadline", async () => {
    await expect(
      withWalletSignatureTimeout(Promise.resolve("signature"), 100),
    ).resolves.toBe("signature");
  });

  it("rejects a connector that never settles", async () => {
    vi.useFakeTimers();
    const signing = withWalletSignatureTimeout(
      new Promise<never>(() => {}),
      1_000,
    );
    const assertion = expect(signing).rejects.toBeInstanceOf(
      WalletSignatureTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
  });
});
