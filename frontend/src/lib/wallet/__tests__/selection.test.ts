import { describe, expect, it } from "vitest";
import {
  isLegacyWaasSolanaWallet,
  selectSolanaWallet,
} from "@/lib/wallet/selection";

type TestWallet = {
  id: string;
  solana: boolean;
  connector?: { key?: string; name?: string; overrideKey?: string };
};

const isSolana = (wallet: TestWallet) => wallet.solana;

describe("selectSolanaWallet", () => {
  it("prefers the active Solana wallet over a compatible embedded wallet", () => {
    const embedded = {
      id: "embedded-solana",
      solana: true,
      connector: { key: "turnkey-solana" },
    };
    const solflare = {
      id: "solflare",
      solana: true,
      connector: { key: "solflare" },
    };

    expect(selectSolanaWallet(solflare, [embedded, solflare], isSolana)).toBe(
      solflare,
    );
  });

  it("uses the embedded Solana wallet when the active wallet is not Solana", () => {
    const evm = {
      id: "embedded-evm",
      solana: false,
      connector: { key: "turnkey-evm" },
    };
    const embeddedSolana = {
      id: "embedded-solana",
      solana: true,
      connector: { key: "turnkey-solana" },
    };

    expect(selectSolanaWallet(evm, [evm, embeddedSolana], isSolana)).toBe(
      embeddedSolana,
    );
  });
});

describe("isLegacyWaasSolanaWallet", () => {
  it("flags Dynamic WaaS SVM connectors as legacy signers", () => {
    expect(
      isLegacyWaasSolanaWallet({
        connector: { key: "dynamicwaas-svm" },
      }),
    ).toBe(true);
    expect(
      isLegacyWaasSolanaWallet({
        connector: { name: "Dynamic WaaS Solana" },
      }),
    ).toBe(true);
  });

  it("does not flag Turnkey embedded Solana wallets", () => {
    expect(
      isLegacyWaasSolanaWallet({
        connector: { key: "turnkey-solana" },
      }),
    ).toBe(false);
  });
});
