import { describe, expect, it, vi } from "vitest";
import {
  activateDynamicSolanaWallet,
  signDynamicSolanaMessage,
} from "@/features/wallet-runtime/infrastructure/dynamicSolanaMessageSigner";

describe("Dynamic Solana message signer", () => {
  it("activates a secondary Solana wallet before Dynamic signing", async () => {
    const setPrimaryWallet = vi.fn().mockResolvedValue(undefined);

    await activateDynamicSolanaWallet(
      { id: "solana-wallet" },
      { id: "evm-wallet" },
      setPrimaryWallet,
    );

    expect(setPrimaryWallet).toHaveBeenCalledWith("solana-wallet");
  });

  it("keeps an already-primary Solana wallet active", async () => {
    const setPrimaryWallet = vi.fn();

    await activateDynamicSolanaWallet(
      { id: "solana-wallet" },
      { id: "solana-wallet" },
      setPrimaryWallet,
    );

    expect(setPrimaryWallet).not.toHaveBeenCalled();
  });

  it("uses the embedded connector directly without primary-wallet sync", async () => {
    const signature = new Uint8Array(64).fill(7);
    const signUint8ArrayMessage = vi.fn().mockResolvedValue(signature);
    const getSigner = vi.fn();

    await expect(
      signDynamicSolanaMessage(
        { connector: { signUint8ArrayMessage }, getSigner },
        new Uint8Array([1, 2, 3]),
      ),
    ).resolves.toEqual(signature);

    expect(signUint8ArrayMessage).toHaveBeenCalledWith(
      new Uint8Array([1, 2, 3]),
    );
    expect(getSigner).not.toHaveBeenCalled();
  });

  it("normalizes the standard Dynamic signer response for other wallets", async () => {
    const signature = new Uint8Array(64).fill(9);
    const signMessage = vi.fn().mockResolvedValue({ signature });

    await expect(
      signDynamicSolanaMessage(
        { getSigner: vi.fn().mockResolvedValue({ signMessage }) },
        new Uint8Array([4, 5, 6]),
      ),
    ).resolves.toEqual(signature);
  });

  it("rejects connectors that cannot sign messages", async () => {
    await expect(
      signDynamicSolanaMessage({}, new Uint8Array([1])),
    ).rejects.toThrow("does not expose signMessage");
  });
});
