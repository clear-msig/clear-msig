import { PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signMessageWithInjectedProvider } from "@/lib/wallet/injectedSolana";

const signer = new PublicKey("11111111111111111111111111111112");

describe("injected Solana message signing", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("uses the connector-matching provider with the expected public key", async () => {
    const signature = new Uint8Array(64).fill(7);
    const signMessage = vi.fn().mockResolvedValue({ signature });
    (globalThis as { window?: unknown }).window = {
      phantom: {
        solana: {
          isPhantom: true,
          publicKey: { toString: () => signer.toBase58() },
          signMessage,
        },
      },
    };

    await expect(
      signMessageWithInjectedProvider({
        connectorKey: "phantom",
        expectedPublicKey: signer,
        bytes: new Uint8Array([1, 2, 3]),
      }),
    ).resolves.toEqual(signature);
    expect(signMessage).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "utf8");
  });

  it("does not call an injected wallet whose public key is different", async () => {
    const signMessage = vi.fn();
    (globalThis as { window?: unknown }).window = {
      solana: {
        isPhantom: true,
        publicKey: { toString: () => "11111111111111111111111111111113" },
        signMessage,
      },
    };

    await expect(
      signMessageWithInjectedProvider({
        connectorKey: "phantom",
        expectedPublicKey: signer,
        bytes: new Uint8Array([1]),
      }),
    ).resolves.toBeNull();
    expect(signMessage).not.toHaveBeenCalled();
  });
});
